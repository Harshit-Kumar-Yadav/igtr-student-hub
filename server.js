const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

// Optional PostgreSQL attendance storage. Without DATABASE_URL, the original
// JSON-file storage remains active.
let attendancePool = null;
let attendanceDbReady = null;
if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    attendancePool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
    });
}



const root = __dirname;


/* =========================================================
   FILE PATHS
========================================================= */

const studentsPath = path.join(
    root,
    'data',
    'students.json'
);

const teachersPath = path.join(
    root,
    'data',
    'teachers.json'
);

const attendancePath = path.join(
    root,
    'data',
    'attendance.json'
);

const noticesPath = path.join(
    root,
    'data',
    'notices.json'
);

const reviewsPath = path.join(
    root,
    'data',
    'reviews.json'
);


/* =========================================================
   LOAD DATA
========================================================= */

const students = JSON.parse(
    fs.readFileSync(
        studentsPath,
        'utf8'
    )
);

const teachers = JSON.parse(
    fs.readFileSync(
        teachersPath,
        'utf8'
    )
);


/* =========================================================
   ATTENDANCE BATCH MAPPING
========================================================= */

const attendanceBatchMap = {

    computer: {

        "4": [
            "80401",
            "80402",
            "80403",
            "80404",
            "80405",
            "80406",
            "80407",
            "80408",
            "80412",
            "80413",
            "80414",
            "80415",
            "80416",
            "80417",
            "80418",
            "80419",
            "80420",
            "80421",
            "80424",
            "80425"
        ],

        "5": [
            "80502",
            "80503",
            "80504",
            "80505",
            "80506",
            "80508",
            "80509",
            "80510",
            "80511",
            "80512",
            "80513",
            "80514",
            "80516",
            "80517",
            "80518L",
            "80519L",
            "80520L",
            "80521L"
        ],

        "6": [
            "80401",
            "80402",
            "80403",
            "80404",
            "80405",
            "80406",
            "80407",
            "80408",
            "80412",
            "80413",
            "80414",
            "80415",
            "80416",
            "80417",
            "80418",
            "80419",
            "80420",
            "80421",
            "80422",
            "80424",
            "80425"
        ]

    }

};


/* =========================================================
   MIME TYPES
========================================================= */

const mime = {

    '.html':
        'text/html; charset=utf-8',

    '.css':
        'text/css; charset=utf-8',

    '.js':
        'text/javascript; charset=utf-8',

    '.json':
        'application/json; charset=utf-8',

    '.pdf':
        'application/pdf',

    '.txt':
        'text/plain; charset=utf-8'

};


/* =========================================================
   SESSIONS
========================================================= */

// Student sessions
const sessions = new Map();

// Teacher sessions
const teacherSessions = new Map();


/* =========================================================
   BASIC HELPERS
========================================================= */

function send(
    res,
    status,
    type,
    body,
    extraHeaders = {}
) {

    res.writeHead(
        status,
        {
            'Content-Type': type,
            ...extraHeaders
        }
    );

    res.end(body);

}


function json(
    res,
    status,
    data,
    extraHeaders = {}
) {

    send(
        res,
        status,
        'application/json; charset=utf-8',
        JSON.stringify(data),
        extraHeaders
    );

}


function normalize(value) {

    return String(
        value ?? ''
    ).trim();

}


/* =========================================================
   COOKIE HELPERS
========================================================= */

function parseCookies(req) {

    const cookies = {};

    const header =
        req.headers.cookie || '';

    header
        .split(';')
        .forEach(part => {

            const index =
                part.indexOf('=');

            if (index === -1) {
                return;
            }

            const key =
                part.slice(
                    0,
                    index
                ).trim();

            const value =
                part.slice(
                    index + 1
                ).trim();

            if (key) {

                cookies[key] =
                    decodeURIComponent(
                        value
                    );

            }

        });

    return cookies;

}


/* =========================================================
   STUDENT SESSION
========================================================= */

function getSession(req) {

    const cookies =
        parseCookies(req);

    const sessionId =
        cookies.igtr_session;

    if (!sessionId) {
        return null;
    }

    const student =
        sessions.get(sessionId);

    if (!student) {
        return null;
    }

    return {
        sessionId,
        student
    };

}


function requireSession(
    req,
    res
) {

    const session =
        getSession(req);

    if (!session) {

        json(
            res,
            401,
            {
                error:
                    'Login required'
            }
        );

        return null;
    }

    return session;

}


/* =========================================================
   TEACHER SESSION
========================================================= */

function sanitizeTeacher(
    teacher
) {

    return {

        username:
            teacher.username,

        name:
            teacher.name,

        course:
            teacher.course,

        batches:
            Array.isArray(
                teacher.batches
            )
                ? teacher.batches
                : []

    };

}


function getTeacherSession(
    req
) {

    const cookies =
        parseCookies(req);

    const sessionId =
        cookies.igtr_teacher_session;

    if (!sessionId) {
        return null;
    }

    const teacher =
        teacherSessions.get(
            sessionId
        );

    if (!teacher) {
        return null;
    }

    return {

        sessionId,

        teacher

    };

}


function requireTeacher(
    req,
    res
) {

    const session =
        getTeacherSession(req);

    if (!session) {

        json(
            res,
            401,
            {
                error:
                    'Teacher login required.'
            }
        );

        return null;
    }

    return session;

}


/* =========================================================
   REQUEST BODY
========================================================= */

function readRequestBody(req) {

    return new Promise(
        (
            resolve,
            reject
        ) => {

            let body = '';

            req.on(
                'data',
                chunk => {

                    body += chunk;

                    if (
                        body.length >
                        1024 * 1024
                    ) {

                        req.destroy();

                        reject(
                            new Error(
                                'Request too large'
                            )
                        );

                    }

                }
            );

            req.on(
                'end',
                () => resolve(body)
            );

            req.on(
                'error',
                reject
            );

        }
    );

}


/* =========================================================
   PASSWORD HASH
========================================================= */

function hashPassword(
    password
) {

    return crypto
        .createHash('sha256')
        .update(
            String(password)
        )
        .digest('hex');

}


/* =========================================================
   DATE HELPERS
========================================================= */

function isValidDate(
    value
) {

    const date =
        normalize(value);

    return /^\d{4}-\d{2}-\d{2}$/
        .test(date);

}


function todayString() {

    const now =
        new Date();

    const year =
        now.getFullYear();

    const month =
        String(
            now.getMonth() + 1
        ).padStart(2, '0');

    const day =
        String(
            now.getDate()
        ).padStart(2, '0');

    return (
        year +
        '-' +
        month +
        '-' +
        day
    );

}


function isFutureDate(
    dateString
) {

    if (!isValidDate(dateString)) {
        return false;
    }

    return dateString >
        todayString();

}


/* =========================================================
   ATTENDANCE FILE
========================================================= */

function loadAttendance() {

    try {

        if (
            !fs.existsSync(
                attendancePath
            )
        ) {

            const initialData = {
                records: []
            };

            fs.writeFileSync(
                attendancePath,
                JSON.stringify(
                    initialData,
                    null,
                    2
                ),
                'utf8'
            );

            return initialData;

        }

        const raw =
            fs.readFileSync(
                attendancePath,
                'utf8'
            );

        const data =
            JSON.parse(raw);

        if (
            !data ||
            !Array.isArray(
                data.records
            )
        ) {

            return {
                records: []
            };

        }

        return data;

    } catch (error) {

        return {
            records: []
        };

    }

}


function saveAttendance(
    data
) {

    const tempPath =
        attendancePath +
        '.tmp';

    fs.writeFileSync(
        tempPath,
        JSON.stringify(
            data,
            null,
            2
        ),
        'utf8'
    );

    fs.renameSync(
        tempPath,
        attendancePath
    );

}


// Create the table if needed and import legacy records without overwriting any
// database row. The source JSON file is read-only during this process.
async function ensureAttendanceDatabase() {
    if (!attendancePool) return;
    if (!attendanceDbReady) {
        attendanceDbReady = (async () => {
            await attendancePool.query(`
                CREATE TABLE IF NOT EXISTS attendance_records (
                    date TEXT NOT NULL,
                    batch TEXT NOT NULL,
                    marked_by TEXT,
                    marked_by_name TEXT,
                    marked_at TEXT,
                    entries JSONB NOT NULL DEFAULT '{}'::jsonb,
                    PRIMARY KEY (date, batch)
                )
            `);
            let legacy = { records: [] };
            try {
                if (fs.existsSync(attendancePath)) {
                    const parsed = JSON.parse(fs.readFileSync(attendancePath, 'utf8'));
                    if (parsed && Array.isArray(parsed.records)) legacy = parsed;
                }
            } catch (error) {
                console.error('Legacy attendance import skipped:', error.message);
            }
            for (const record of legacy.records) {
                if (!record || !record.date || record.batch === undefined || !record.entries) continue;
                await attendancePool.query(
                    `INSERT INTO attendance_records
                     (date, batch, marked_by, marked_by_name, marked_at, entries)
                     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
                     ON CONFLICT (date, batch) DO NOTHING`,
                    [String(record.date), String(record.batch), record.markedBy || null,
                     record.markedByName || null, record.markedAt || null,
                     JSON.stringify(record.entries)]
                );
            }
        })().catch(error => {
            attendanceDbReady = null;
            throw error;
        });
    }
    await attendanceDbReady;
}

async function getAttendanceData() {
    if (!attendancePool) return loadAttendance();
    await ensureAttendanceDatabase();
    const result = await attendancePool.query(
        `SELECT date, batch, marked_by, marked_by_name, marked_at, entries
         FROM attendance_records ORDER BY date DESC`
    );
    return { records: result.rows.map(row => ({
        date: row.date, batch: row.batch, markedBy: row.marked_by,
        markedByName: row.marked_by_name, markedAt: row.marked_at,
        entries: row.entries || {}
    })) };
}

async function persistAttendanceRecord(record) {
    if (!attendancePool) {
        const attendance = loadAttendance();
        const index = attendance.records.findIndex(item =>
            String(item.batch) === String(record.batch) && item.date === record.date
        );
        if (index >= 0) attendance.records[index] = record;
        else attendance.records.push(record);
        attendance.records.sort((a, b) => String(b.date).localeCompare(String(a.date)));
        saveAttendance(attendance);
        return;
    }
    await ensureAttendanceDatabase();
    await attendancePool.query(
        `INSERT INTO attendance_records
         (date, batch, marked_by, marked_by_name, marked_at, entries)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (date, batch) DO UPDATE SET
           marked_by = EXCLUDED.marked_by,
           marked_by_name = EXCLUDED.marked_by_name,
           marked_at = EXCLUDED.marked_at,
           entries = EXCLUDED.entries`,
        [String(record.date), String(record.batch), record.markedBy || null,
         record.markedByName || null, record.markedAt || null,
         JSON.stringify(record.entries || {})]
    );
}


/* =========================================================
   NOTICE BOARD
========================================================= */

function loadNotices() {

    try {

        if (
            !fs.existsSync(
                noticesPath
            )
        ) {

            const initialData = {
                notices: []
            };

            fs.writeFileSync(
                noticesPath,
                JSON.stringify(
                    initialData,
                    null,
                    2
                ),
                'utf8'
            );

            return initialData;
        }

        const raw =
            fs.readFileSync(
                noticesPath,
                'utf8'
            );

        const data =
            JSON.parse(raw);

        if (
            !data ||
            !Array.isArray(
                data.notices
            )
        ) {

            return {
                notices: []
            };

        }

        return data;

    } catch (error) {

        return {
            notices: []
        };

    }

}


function saveNotices(
    data
) {

    const tempPath =
        noticesPath +
        '.tmp';

    fs.writeFileSync(
        tempPath,
        JSON.stringify(
            data,
            null,
            2
        ),
        'utf8'
    );

    fs.renameSync(
        tempPath,
        noticesPath
    );

}


/* =========================================================
   REVIEW SYSTEM - FILE
========================================================= */

function loadReviews() {

    try {

        if (
            !fs.existsSync(
                reviewsPath
            )
        ) {

            const initialData = {
                reviews: []
            };

            fs.writeFileSync(
                reviewsPath,
                JSON.stringify(
                    initialData,
                    null,
                    2
                ),
                'utf8'
            );

            return initialData;

        }

        const raw =
            fs.readFileSync(
                reviewsPath,
                'utf8'
            );

        const data =
            JSON.parse(raw);

        if (
            !data ||
            !Array.isArray(
                data.reviews
            )
        ) {

            return {
                reviews: []
            };

        }

        return data;

    } catch (error) {

        return {
            reviews: []
        };

    }

}


function saveReviews(
    data
) {

    const tempPath =
        reviewsPath +
        '.tmp';

    fs.writeFileSync(
        tempPath,
        JSON.stringify(
            data,
            null,
            2
        ),
        'utf8'
    );

    fs.renameSync(
        tempPath,
        reviewsPath
    );

}


/* =========================================================
   BATCH HELPERS
========================================================= */

function getAllowedRollNumbers(
    batch
) {

    const rolls =
        attendanceBatchMap
            .computer?.[
                String(batch)
            ];

    if (
        !Array.isArray(rolls)
    ) {

        return [];

    }

    return rolls.map(
        roll =>
            String(roll)
    );

}


function getBatchStudents(
    batch
) {

    const allowedRolls =
        getAllowedRollNumbers(
            batch
        );

    return students.filter(
        student => {

            const roll =
                normalize(
                    student.rollNo
                );

            const course =
                normalize(
                    student.course
                )
                .toLowerCase();

            return (

                allowedRolls.includes(
                    roll
                )

                &&

                course ===
                    'diploma in computer science'

            );

        }
    );

}


function teacherOwnsBatch(
    teacher,
    batch
) {

    if (
        !teacher ||
        !Array.isArray(
            teacher.batches
        )
    ) {

        return false;

    }

    return teacher.batches
        .map(String)
        .includes(
            String(batch)
        );

}


/* =========================================================
   PDF HELPERS
========================================================= */

function getPDFs(query) {

    const course =
        query.course || '';

    const year =
        'Year-' +
        (
            query.year ||
            '1'
        );

    const semester =
        'Semester-' +
        (
            query.semester ||
            '1'
        );

    const subject =
        query.subject || '';

    const out = [];

    for (
        let i = 1;
        i <= 4;
        i++
    ) {

        const dir =
            path.join(
                root,
                'pdfs',
                course,
                year,
                semester,
                subject,
                'Unit-' + i
            );

        let files = [];

        try {

            files =
                fs
                    .readdirSync(dir)
                    .filter(
                        file =>
                            file
                                .toLowerCase()
                                .endsWith(
                                    '.pdf'
                                )
                    )
                    .map(
                        file => ({

                            name: file,

                            url:
                                '/pdf/' +

                                encodeURIComponent(
                                    course
                                ) +

                                '/' +

                                encodeURIComponent(
                                    year
                                ) +

                                '/' +

                                encodeURIComponent(
                                    semester
                                ) +

                                '/' +

                                encodeURIComponent(
                                    subject
                                ) +

                                '/' +

                                encodeURIComponent(
                                    'Unit-' + i
                                ) +

                                '/' +

                                encodeURIComponent(
                                    file
                                )

                        })
                    );

        } catch (_) {

            // Folder may not exist.

        }

        out.push(
            files
        );

    }

    return out;

}


/* =========================================================
   SERVER
========================================================= */

const server =
    http.createServer(
        async (
            req,
            res
        ) => {

            const u =
                url.parse(
                    req.url,
                    true
                );


            /* =================================================
               STUDENT LOGIN
            ================================================= */

            if (
                u.pathname ===
                    '/api/login'

                &&

                req.method ===
                    'POST'
            ) {

                try {

                    const body =
                        await readRequestBody(
                            req
                        );

                    const data =
                        JSON.parse(
                            body || '{}'
                        );

                    const rollNo =
                        normalize(
                            data.rollNo
                        );

                    const password =
                        normalize(
                            data.password
                        );

                    const course =
                        normalize(
                            data.course
                        );


                    const student =
                        students.find(
                            item =>
                                normalize(
                                    item.rollNo
                                ) === rollNo
                        );


                    if (
                        !student ||
                        password !==
                            normalize(
                                student.rollNo
                            )
                    ) {

                        return json(
                            res,
                            401,
                            {
                                error:
                                    'Invalid Roll Number or Password.'
                            }
                        );

                    }


                    if (
                        course !==
                            normalize(
                                student.course
                            )
                    ) {

                        return json(
                            res,
                            401,
                            {
                                error:
                                    'Selected course does not match this Roll Number.'
                            }
                        );

                    }


                    const normalizedCourse =
                        course.toLowerCase();


                    if (
                        normalizedCourse ===
                            'diploma in computer science'

                        &&

                        !/^80\d+L?$/.test(
                            rollNo
                        )
                    ) {

                        return json(
                            res,
                            401,
                            {
                                error:
                                    'Computer Science Roll Number must start with 80.'
                            }
                        );

                    }


                    if (
                        normalizedCourse ===
                            'diploma in mechatronics'

                        &&

                        !/^60\d+$/
                            .test(
                                rollNo
                            )
                    ) {

                        return json(
                            res,
                            401,
                            {
                                error:
                                    'Mechatronics Roll Number must start with 60.'
                            }
                        );

                    }


                    const sessionId =
                        crypto
                            .randomBytes(32)
                            .toString(
                                'hex'
                            );


                    sessions.set(
                        sessionId,
                        student
                    );


                    return json(
                        res,
                        200,
                        {
                            student
                        },
                        {

                            'Set-Cookie':
                                `igtr_session=${encodeURIComponent(
                                    sessionId
                                )}; HttpOnly; Path=/; SameSite=Lax`

                        }
                    );


                } catch (error) {

                    return json(
                        res,
                        400,
                        {
                            error:
                                'Invalid request.'
                        }
                    );

                }

            }


            /* =================================================
               STUDENT SESSION
            ================================================= */

            if (
                u.pathname ===
                    '/api/session'

                &&

                req.method ===
                    'GET'
            ) {

                const session =
                    getSession(
                        req
                    );

                return json(
                    res,
                    200,
                    {

                        loggedIn:
                            Boolean(
                                session
                            ),

                        student:
                            session
                                ? session.student
                                : null

                    }
                );

            }


            /* =================================================
               STUDENT LOGOUT
            ================================================= */

            if (
                u.pathname ===
                    '/api/logout'

                &&

                req.method ===
                    'POST'
            ) {

                const cookies =
                    parseCookies(
                        req
                    );

                const sessionId =
                    cookies
                        .igtr_session;

                if (sessionId) {

                    sessions.delete(
                        sessionId
                    );

                }


                return json(
                    res,
                    200,
                    {
                        success: true
                    },
                    {

                        'Set-Cookie':
                            'igtr_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax'

                    }
                );

            }


            /* =================================================
               TEACHER LOGIN
            ================================================= */

            if (
                u.pathname ===
                    '/api/teacher/login'

                &&

                req.method ===
                    'POST'
            ) {

                try {

                    const body =
                        await readRequestBody(
                            req
                        );

                    const data =
                        JSON.parse(
                            body || '{}'
                        );

                    const username =
                        normalize(
                            data.username
                        );

                    const password =
                        String(
                            data.password ||
                            ''
                        );


                    const passwordHash =
                        hashPassword(
                            password
                        );


                    const teacher =
                        teachers.find(
                            item =>
                                normalize(
                                    item.username
                                ) === username

                                &&

                                normalize(
                                    item.passwordHash
                                ) ===
                                    passwordHash
                        );


                    if (!teacher) {

                        return json(
                            res,
                            401,
                            {
                                error:
                                    'Invalid Teacher ID or Password.'
                            }
                        );

                    }


                    const teacherSessionId =
                        crypto
                            .randomBytes(32)
                            .toString(
                                'hex'
                            );


                    teacherSessions.set(
                        teacherSessionId,
                        teacher
                    );


                    return json(
                        res,
                        200,
                        {

                            success:
                                true,

                            teacher:
                                sanitizeTeacher(
                                    teacher
                                )

                        },
                        {

                            'Set-Cookie':
                                `igtr_teacher_session=${encodeURIComponent(
                                    teacherSessionId
                                )}; HttpOnly; Path=/; SameSite=Lax`

                        }
                    );


                } catch (error) {

                    return json(
                        res,
                        400,
                        {
                            error:
                                'Invalid teacher login request.'
                        }
                    );

                }

            }


            /* =================================================
               TEACHER SESSION
            ================================================= */

            if (
                u.pathname ===
                    '/api/teacher/session'

                &&

                req.method ===
                    'GET'
            ) {

                const session =
                    getTeacherSession(
                        req
                    );

                return json(
                    res,
                    200,
                    {

                        loggedIn:
                            Boolean(
                                session
                            ),

                        teacher:
                            session
                                ? sanitizeTeacher(
                                    session.teacher
                                )
                                : null

                    }
                );

            }


            /* =================================================
               TEACHER LOGOUT
            ================================================= */

            if (
                u.pathname ===
                    '/api/teacher/logout'

                &&

                req.method ===
                    'POST'
            ) {

                const cookies =
                    parseCookies(
                        req
                    );

                const teacherSessionId =
                    cookies
                        .igtr_teacher_session;

                if (
                    teacherSessionId
                ) {

                    teacherSessions.delete(
                        teacherSessionId
                    );

                }


                return json(
                    res,
                    200,
                    {
                        success: true
                    },
                    {

                        'Set-Cookie':
                            'igtr_teacher_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax'

                    }
                );

            }


            /* =================================================
               NOTICE BOARD - GET
            ================================================= */

            if (
                u.pathname ===
                    '/api/notices'

                &&

                req.method ===
                    'GET'
            ) {

                const noticeData =
                    loadNotices();

                const notices =
                    Array.isArray(
                        noticeData.notices
                    )
                        ? noticeData.notices
                        : [];

                return json(
                    res,
                    200,
                    {
                        notices
                    }
                );

            }


            /* =================================================
               NOTICE BOARD - CREATE
            ================================================= */

            if (
                u.pathname ===
                    '/api/teacher/notices'

                &&

                req.method ===
                    'POST'
            ) {

                const session =
                    requireTeacher(
                        req,
                        res
                    );

                if (!session) {
                    return;
                }


                try {

                    const body =
                        await readRequestBody(
                            req
                        );

                    const data =
                        JSON.parse(
                            body || '{}'
                        );


                    const title =
                        normalize(
                            data.title
                        );

                    const category =
                        normalize(
                            data.category
                        ) || 'General';

                    const message =
                        normalize(
                            data.message
                        );


                    if (!title) {

                        return json(
                            res,
                            400,
                            {
                                error:
                                    'Notice title is required.'
                            }
                        );

                    }


                    if (!message) {

                        return json(
                            res,
                            400,
                            {
                                error:
                                    'Notice message is required.'
                            }
                        );

                    }


                    const noticeData =
                        loadNotices();


                    if (
                        !Array.isArray(
                            noticeData.notices
                        )
                    ) {

                        noticeData.notices = [];

                    }


                    const notice = {

                        id:
                            crypto
                                .randomBytes(8)
                                .toString('hex'),

                        title,

                        category,

                        message,

                        postedBy:
                            session.teacher.name,

                        postedByUsername:
                            session.teacher.username,

                        date:
                            todayString(),

                        createdAt:
                            new Date()
                                .toISOString()

                    };


                    noticeData.notices.unshift(
                        notice
                    );


                    saveNotices(
                        noticeData
                    );


                    return json(
                        res,
                        201,
                        {

                            success: true,

                            message:
                                'Notice posted successfully.',

                            notice

                        }
                    );


                } catch (error) {

                    console.error(
                        'Notice create error:',
                        error
                    );


                    return json(
                        res,
                        400,
                        {
                            error:
                                'Invalid notice request.'
                        }
                    );

                }

            }


            /* =================================================
               NOTICE BOARD - DELETE
            ================================================= */

            if (
                u.pathname ===
                    '/api/teacher/notices'

                &&

                req.method ===
                    'DELETE'
            ) {

                const session =
                    requireTeacher(
                        req,
                        res
                    );

                if (!session) {
                    return;
                }


                const noticeId =
                    normalize(
                        u.query.id
                    );


                if (!noticeId) {

                    return json(
                        res,
                        400,
                        {
                            error:
                                'Notice ID is required.'
                        }
                    );

                }


                const noticeData =
                    loadNotices();


                if (
                    !Array.isArray(
                        noticeData.notices
                    )
                ) {

                    noticeData.notices = [];

                }


                const noticeIndex =
                    noticeData.notices.findIndex(
                        notice =>
                            String(
                                notice.id
                            ) === noticeId
                    );


                if (
                    noticeIndex === -1
                ) {

                    return json(
                        res,
                        404,
                        {
                            error:
                                'Notice not found.'
                        }
                    );

                }


                noticeData.notices.splice(
                    noticeIndex,
                    1
                );


                saveNotices(
                    noticeData
                );


                return json(
                    res,
                    200,
                    {

                        success: true,

                        message:
                            'Notice deleted successfully.'

                    }
                );

            }


            /* =================================================
               TEACHER STUDENTS
            ================================================= */

            if (
                u.pathname ===
                    '/api/teacher/students'

                &&

                req.method ===
                    'GET'
            ) {

                const session =
                    requireTeacher(
                        req,
                        res
                    );


                if (!session) {
                    return;
                }


                const batch =
                    normalize(
                        u.query.batch
                    );


                if (!batch) {

                    return json(
                        res,
                        400,
                        {
                            error:
                                'Batch is required.'
                        }
                    );

                }


                if (
                    !teacherOwnsBatch(
                        session.teacher,
                        batch
                    )
                ) {

                    return json(
                        res,
                        403,
                        {
                            error:
                                'You are not authorized for this batch.'
                        }
                    );

                }


                const batchStudents =
                    getBatchStudents(
                        batch
                    );


                return json(
                    res,
                    200,
                    {

                        batch,

                        students:
                            batchStudents

                    }
                );

            }


            /* =================================================
               TEACHER ATTENDANCE GET
            ================================================= */

            if (
                u.pathname ===
                    '/api/teacher/attendance'

                &&

                req.method ===
                    'GET'
            ) {

                const session =
                    requireTeacher(
                        req,
                        res
                    );


                if (!session) {
                    return;
                }


                const batch =
                    normalize(
                        u.query.batch
                    );

                const requestedDate =
                    normalize(
                        u.query.date
                    );


                if (!batch) {

                    return json(
                        res,
                        400,
                        {
                            error:
                                'Batch is required.'
                        }
                    );

                }


                if (
                    !teacherOwnsBatch(
                        session.teacher,
                        batch
                    )
                ) {

                    return json(
                        res,
                        403,
                        {
                            error:
                                'You are not authorized for this batch.'
                        }
                    );

                }


                const attendance = await getAttendanceData();


                let records =
                    attendance.records
                        .filter(
                            record =>
                                String(
                                    record.batch
                                ) ===
                                    String(batch)
                        );


                if (
                    requestedDate
                    &&
                    isValidDate(
                        requestedDate
                    )
                ) {

                    records =
                        records.filter(
                            record =>
                                record.date ===
                                    requestedDate
                        );

                }


                records =
                    records.sort(
                        (
                            a,
                            b
                        ) =>
                            String(
                                b.date
                            ).localeCompare(
                                String(
                                    a.date
                                )
                            )
                    );


                if (
                    requestedDate
                ) {

                    return json(
                        res,
                        200,
                        {

                            record:
                                records[0]
                                || null

                        }
                    );

                }


                return json(
                    res,
                    200,
                    {
                        records
                    }
                );

            }


            /* =================================================
               TEACHER ATTENDANCE SAVE
            ================================================= */

            if (
                u.pathname ===
                    '/api/teacher/attendance'

                &&

                req.method ===
                    'POST'
            ) {

                const session =
                    requireTeacher(
                        req,
                        res
                    );


                if (!session) {
                    return;
                }


                try {

                    const body =
                        await readRequestBody(
                            req
                        );

                    const data =
                        JSON.parse(
                            body || '{}'
                        );


                    const batch =
                        normalize(
                            data.batch
                        );

                    const date =
                        normalize(
                            data.date
                        );

                    const entries =
                        data.entries;


                    if (!batch) {

                        return json(
                            res,
                            400,
                            {
                                error:
                                    'Batch is required.'
                            }
                        );

                    }


                    if (!isValidDate(date)) {

                        return json(
                            res,
                            400,
                            {
                                error:
                                    'Valid attendance date is required.'
                            }
                        );

                    }


                    if (
                        isFutureDate(
                            date
                        )
                    ) {

                        return json(
                            res,
                            400,
                            {
                                error:
                                    'Future date attendance is not allowed.'
                            }
                        );

                    }


                    if (
                        !teacherOwnsBatch(
                            session.teacher,
                            batch
                        )
                    ) {

                        return json(
                            res,
                            403,
                            {
                                error:
                                    'You are not authorized for this batch.'
                            }
                        );

                    }


                    if (
                        !entries
                        ||
                        typeof entries !==
                            'object'
                    ) {

                        return json(
                            res,
                            400,
                            {
                                error:
                                    'Attendance entries are required.'
                            }
                        );

                    }


                    const batchStudents =
                        getBatchStudents(
                            batch
                        );


                    if (
                        batchStudents.length ===
                        0
                    ) {

                        return json(
                            res,
                            400,
                            {
                                error:
                                    'No students are mapped to this batch yet.'
                            }
                        );

                    }


                    const allowedRolls =
                        batchStudents.map(
                            student =>
                                normalize(
                                    student.rollNo
                                )
                        );


                    const cleanEntries =
                        {};


                    for (
                        const roll of
                        allowedRolls
                    ) {

                        const status =
                            normalize(
                                entries[
                                    roll
                                ]
                            );


                        if (
                            status !== 'P'
                            &&
                            status !== 'A'
                        ) {

                            return json(
                                res,
                                400,
                                {
                                    error:
                                        `Attendance status missing for roll number ${roll}.`
                                }
                            );

                        }


                        cleanEntries[
                            roll
                        ] = status;

                    }

                    const record = {
                        date,
                        batch,
                        markedBy: session.teacher.username,
                        markedByName: session.teacher.name,
                        markedAt: new Date().toISOString(),
                        entries: cleanEntries
                    };

                    const existingAttendance = await getAttendanceData();
                    const existingIndex = existingAttendance.records.findIndex(item =>
                        String(item.batch) === String(batch) && item.date === date
                    );

                    await persistAttendanceRecord(record);


                    const present =
                        Object.values(
                            cleanEntries
                        )
                        .filter(
                            value =>
                                value === 'P'
                        )
                        .length;


                    const absent =
                        Object.values(
                            cleanEntries
                        )
                        .filter(
                            value =>
                                value === 'A'
                        )
                        .length;


                    return json(
                        res,
                        200,
                        {

                            success:
                                true,

                            message:
                                existingIndex >=
                                0
                                    ? 'Attendance updated successfully.'
                                    : 'Attendance saved successfully.',

                            date,

                            batch,

                            present,

                            absent,

                            total:
                                present +
                                absent

                        }
                    );


                } catch (error) {

                    console.error(
                        'Attendance save error:',
                        error
                    );


                    return json(
                        res,
                        400,
                        {
                            error:
                                'Invalid attendance request.'
                        }
                    );

                }

            }


            /* =================================================
               STUDENT REVIEW - SUBMIT
            ================================================= */

            if (
                u.pathname ===
                    '/api/reviews'

                &&

                req.method ===
                    'POST'
            ) {

                const session =
                    requireSession(
                        req,
                        res
                    );

                if (!session) {
                    return;
                }


                try {

                    const body =
                        await readRequestBody(
                            req
                        );

                    const data =
                        JSON.parse(
                            body || '{}'
                        );


                    const rollNo =
                        normalize(
                            data.rollNo
                        );

                    const rating =
                        Number(
                            data.rating
                        );

                    const review =
                        normalize(
                            data.review
                        );


                    if (!rollNo) {

                        return json(
                            res,
                            400,
                            {
                                error:
                                    'Roll Number is required.'
                            }
                        );

                    }


                    const loggedInRoll =
                        normalize(
                            session.student.rollNo
                        );


                    if (
                        rollNo !==
                        loggedInRoll
                    ) {

                        return json(
                            res,
                            403,
                            {
                                error:
                                    'Roll Number does not match the logged-in student.'
                            }
                        );

                    }


                    if (
                        !Number.isInteger(
                            rating
                        )
                        ||
                        rating < 1
                        ||
                        rating > 5
                    ) {

                        return json(
                            res,
                            400,
                            {
                                error:
                                    'Rating must be between 1 and 5 stars.'
                            }
                        );

                    }


                    if (!review) {

                        return json(
                            res,
                            400,
                            {
                                error:
                                    'Please write your review.'
                            }
                        );

                    }


                    if (
                        review.length >
                        1000
                    ) {

                        return json(
                            res,
                            400,
                            {
                                error:
                                    'Review cannot exceed 1000 characters.'
                            }
                        );

                    }


                    const reviewData =
                        loadReviews();


                    if (
                        !Array.isArray(
                            reviewData.reviews
                        )
                    ) {

                        reviewData.reviews =
                            [];

                    }


                    const existingReview =
                        reviewData.reviews.find(
                            item =>
                                normalize(
                                    item.rollNo
                                ) ===
                                    rollNo
                        );


                    if (existingReview) {

                        return json(
                            res,
                            409,
                            {
                                error:
                                    'You have already submitted a review.'
                            }
                        );

                    }


                    const newReview = {

                        id:
                            crypto
                                .randomBytes(8)
                                .toString('hex'),

                        rollNo,

                        name:
                            session.student.name
                            ||
                            'Student',

                        course:
                            session.student.course
                            ||
                            '',

                        rating,

                        review,

                        date:
                            todayString(),

                        createdAt:
                            new Date()
                                .toISOString()

                    };


                    reviewData.reviews.unshift(
                        newReview
                    );


                    saveReviews(
                        reviewData
                    );


                    return json(
                        res,
                        201,
                        {

                            success:
                                true,

                            message:
                                'Your review has been submitted successfully.',

                            review: {

                                rating:
                                    newReview.rating,

                                review:
                                    newReview.review,

                                date:
                                    newReview.date

                            }

                        }
                    );


                } catch (error) {

                    console.error(
                        'Review submit error:',
                        error
                    );


                    return json(
                        res,
                        400,
                        {
                            error:
                                'Invalid review request.'
                        }
                    );

                }

            }


            /* =================================================
               STUDENT REVIEW - MY REVIEW
            ================================================= */

            if (
                u.pathname ===
                    '/api/reviews/my'

                &&

                req.method ===
                    'GET'
            ) {

                const session =
                    requireSession(
                        req,
                        res
                    );

                if (!session) {
                    return;
                }


                const loggedInRoll =
                    normalize(
                        session.student.rollNo
                    );


                const reviewData =
                    loadReviews();


                const review =
                    reviewData.reviews.find(
                        item =>
                            normalize(
                                item.rollNo
                            ) ===
                                loggedInRoll
                    );


                return json(
                    res,
                    200,
                    {

                        success:
                            true,

                        submitted:
                            Boolean(
                                review
                            ),

                        review:
                            review
                                ? {

                                    rating:
                                        review.rating,

                                    review:
                                        review.review,

                                    date:
                                        review.date

                                }
                                : null

                    }
                );

            }


            /* =================================================
               TEACHER - VIEW ALL REVIEWS
            ================================================= */

            if (
                u.pathname ===
                    '/api/teacher/reviews'

                &&

                req.method ===
                    'GET'
            ) {

                const session =
                    requireTeacher(
                        req,
                        res
                    );

                if (!session) {
                    return;
                }


                const reviewData =
                    loadReviews();


                const reviews =
                    Array.isArray(
                        reviewData.reviews
                    )
                        ? reviewData.reviews
                        : [];


                return json(
                    res,
                    200,
                    {
                        reviews
                    }
                );

            }


            /* =================================================
               STUDENT: MY ATTENDANCE
            ================================================= */

            if (
                u.pathname ===
                    '/api/attendance/my'

                &&

                req.method ===
                    'GET'
            ) {

                const session =
                    requireSession(
                        req,
                        res
                    );


                if (!session) {
                    return;
                }


                const student =
                    session.student;


                const rollNo =
                    normalize(
                        student.rollNo
                    );


                let studentBatch =
                    null;


                for (
                    const batch of
                    Object.keys(
                        attendanceBatchMap.computer
                    )
                ) {

                    const rolls =
                        getAllowedRollNumbers(
                            batch
                        );


                    if (
                        rolls.includes(
                            rollNo
                        )
                    ) {

                        studentBatch =
                            batch;

                        break;

                    }

                }


                const attendance = await getAttendanceData();


                let history =
                    [];


                if (studentBatch) {

                    history =
                        attendance.records
                            .filter(
                                record =>
                                    String(
                                        record.batch
                                    ) ===
                                        String(
                                            studentBatch
                                        )
                            )
                            .map(
                                record => {

                                    const status =
                                        normalize(
                                            record.entries?.[
                                                rollNo
                                            ]
                                        );


                                    return {

                                        date:
                                            record.date,

                                        batch:
                                            record.batch,

                                        status:
                                            status ||
                                            'A',

                                        markedBy:
                                            record.markedByName
                                            ||
                                            record.markedBy
                                            ||
                                            'Teacher'

                                    };

                                }
                            )
                            .filter(
                                record =>
                                    record.status ===
                                        'P'
                                    ||
                                    record.status ===
                                        'A'
                            )
                            .sort(
                                (
                                    a,
                                    b
                                ) =>
                                    String(
                                        b.date
                                    ).localeCompare(
                                        String(
                                            a.date
                                        )
                                    )
                            );

                }


                const total =
                    history.length;


                const present =
                    history.filter(
                        record =>
                            record.status ===
                            'P'
                    ).length;


                const absent =
                    history.filter(
                        record =>
                            record.status ===
                            'A'
                    ).length;


                const percentage =
                    total > 0
                        ? (
                            present /
                            total
                        ) * 100
                        : 0;


                const overall = {

                    total,

                    present,

                    absent,

                    required: 75,

                    percentage,

                    updatedAt:
                        history.length
                            ? history[0].date
                            : null,

                    subjects: [],

                    recent:
                        history.slice(
                            0,
                            10
                        )

                };


                return json(
                    res,
                    200,
                    {

                        student: {

                            rollNo:
                                student.rollNo,

                            name:
                                student.name,

                            course:
                                student.course

                        },

                        batch:
                            studentBatch,

                        overall,

                        history

                    }
                );

            }


            /* =================================================
               PROTECTED PDF LIST
            ================================================= */

            if (
                u.pathname ===
                    '/api/pdfs'

                &&

                req.method ===
                    'GET'
            ) {

                const session =
                    requireSession(
                        req,
                        res
                    );


                if (!session) {
                    return;
                }


                const requestedCourse =
                    normalize(
                        u.query.course
                    );


                if (
                    requestedCourse !==
                    normalize(
                        session.student.course
                    )
                ) {

                    return json(
                        res,
                        403,
                        {
                            error:
                                'You can access only your selected course.'
                        }
                    );

                }


                return json(
                    res,
                    200,
                    getPDFs(
                        u.query
                    )
                );

            }


            /* =================================================
               PROTECTED PDF FILES
            ================================================= */

            if (
                u.pathname.startsWith(
                    '/pdf/'
                )
            ) {

                const session =
                    requireSession(
                        req,
                        res
                    );


                if (!session) {
                    return;
                }


                const relative =
                    u.pathname.slice(
                        '/pdf/'.length
                    );


                let parts;


                try {

                    parts =
                        relative
                            .split('/')
                            .filter(
                                Boolean
                            )
                            .map(
                                decodeURIComponent
                            );

                } catch (error) {

                    return send(
                        res,
                        400,
                        'text/plain; charset=utf-8',
                        'Invalid PDF path'
                    );

                }


                if (
                    parts.length < 6
                    ||
                    parts[0] === '..'
                    ||
                    parts.includes('..')
                ) {

                    return send(
                        res,
                        400,
                        'text/plain; charset=utf-8',
                        'Invalid PDF path'
                    );

                }


                const requestedCourse =
                    parts[0] || '';


                if (
                    requestedCourse !==
                    normalize(
                        session.student.course
                    )
                ) {

                    return send(
                        res,
                        403,
                        'text/plain; charset=utf-8',
                        'You can access only your selected course.'
                    );

                }


                const file =
                    path.join(
                        root,
                        'pdfs',
                        ...parts
                    );


                const pdfRoot =
                    path.resolve(
                        path.join(
                            root,
                            'pdfs'
                        )
                    );


                const resolved =
                    path.resolve(
                        file
                    );


                if (
                    !resolved.startsWith(
                        pdfRoot +
                        path.sep
                    )
                ) {

                    return send(
                        res,
                        403,
                        'text/plain; charset=utf-8',
                        'Forbidden'
                    );

                }


                if (
                    path
                        .extname(
                            resolved
                        )
                        .toLowerCase()
                    !==
                    '.pdf'
                ) {

                    return send(
                        res,
                        403,
                        'text/plain; charset=utf-8',
                        'Forbidden'
                    );

                }


                try {

                    const stat =
                        fs.statSync(
                            resolved
                        );


                    if (
                        !stat.isFile()
                    ) {

                        throw new Error(
                            'Not a file'
                        );

                    }


                    res.writeHead(
                        200,
                        {

                            'Content-Type':
                                'application/pdf',

                            'Content-Length':
                                stat.size,

                            'Content-Disposition':
                                'inline'

                        }
                    );


                    fs
                        .createReadStream(
                            resolved
                        )
                        .pipe(res);


                } catch (_) {

                    return send(
                        res,
                        404,
                        'text/plain; charset=utf-8',
                        'PDF not found'
                    );

                }


                return;

            }


            /* =================================================
               STATIC FILES
            ================================================= */

            let pathname;


            try {

                pathname =
                    decodeURIComponent(
                        u.pathname
                    );

            } catch (error) {

                return send(
                    res,
                    400,
                    'text/plain; charset=utf-8',
                    'Bad request'
                );

            }


            if (
                pathname === '/'
            ) {

                pathname =
                    '/index.html';

            }


            /* =================================================
               PROTECT SENSITIVE JSON FILES
            ================================================= */

            const sensitiveFiles = [

                '/data/teachers.json',

                '/data/attendance.json',

                '/data/notices.json',

                '/data/reviews.json'

            ];


            if (
                sensitiveFiles.includes(
                    pathname
                )
            ) {

                return send(
                    res,
                    403,
                    'text/plain; charset=utf-8',
                    'Protected data'
                );

            }


            const relativePath =
                pathname
                    .replace(
                        /^[/\\]+/,
                        ''
                    );


            const file =
                path.resolve(
                    path.join(
                        root,
                        relativePath
                    )
                );


            if (
                !(
                    file === root
                    ||
                    file.startsWith(
                        root +
                        path.sep
                    )
                )
            ) {

                return send(
                    res,
                    403,
                    'text/plain; charset=utf-8',
                    'Forbidden'
                );

            }


            const pdfRoot =
                path.resolve(
                    path.join(
                        root,
                        'pdfs'
                    )
                );


            if (
                file === pdfRoot
                ||
                file.startsWith(
                    pdfRoot +
                    path.sep
                )
            ) {

                return send(
                    res,
                    403,
                    'text/plain; charset=utf-8',
                    'PDF access is protected.'
                );

            }


            fs.stat(
                file,
                (
                    error,
                    stat
                ) => {

                    if (
                        error
                        ||
                        !stat.isFile()
                    ) {

                        return send(
                            res,
                            404,
                            'text/plain; charset=utf-8',
                            'Not found'
                        );

                    }


                    const ext =
                        path
                            .extname(
                                file
                            )
                            .toLowerCase();


                    res.writeHead(
                        200,
                        {

                            'Content-Type':
                                mime[ext]
                                ||
                                'application/octet-stream'

                        }
                    );


                    fs
                        .createReadStream(
                            file
                        )
                        .pipe(res);

                }
            );

        }
    );


/* =========================================================
   START SERVER
========================================================= */

const PORT =
    process.env.PORT || 3000;


server.listen(
    PORT,
    '0.0.0.0',
    () => {

        console.log(
            `IGTR Student Hub running on port ${PORT}`
        );

    }
);