async function getSession() {
    try {
        const response = await fetch('/api/session', {
            credentials: 'same-origin'
        });
        return await response.json();
    } catch (error) {
        return { loggedIn: false, student: null };
    }
}

async function requireLogin(redirect = 'student-login.html') {
    const session = await getSession();

    if (!session.loggedIn) {
        location.replace(redirect);
        return null;
    }

    localStorage.setItem('igtrStudent', JSON.stringify(session.student));
    localStorage.setItem('igtrLoggedIn', 'true');

    return session.student;
}

async function studentLogin(rollNo, password, course) {
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rollNo, password, course })
        });

        const data = await response.json();

        if (!response.ok) {
            return {
                success: false,
                message: data.error || 'Invalid Roll Number or Password.'
            };
        }

        localStorage.setItem('igtrStudent', JSON.stringify(data.student));
        localStorage.setItem('igtrLoggedIn', 'true');

        return { success: true, student: data.student };
    } catch (error) {
        return {
            success: false,
            message: 'Server is not running. Start it with: node server.js'
        };
    }
}

function getStudent() {
    try {
        const value = localStorage.getItem('igtrStudent');
        return value ? JSON.parse(value) : null;
    } catch (_) {
        return null;
    }
}

async function studentLogout() {
    try {
        await fetch('/api/logout', {
            method: 'POST',
            credentials: 'same-origin'
        });
    } catch (_) {
        // Continue clearing local data even if the request fails.
    }

    localStorage.removeItem('igtrLoggedIn');
    localStorage.removeItem('igtrStudent');
    location.replace('student-login.html');
}


async function requireCourse(redirect = 'courses.html') {
    const student = await requireLogin('student-login.html');
    if (!student) return null;

    const params = new URLSearchParams(location.search);
    const requestedCourse = (params.get('course') || '').trim();

    if (requestedCourse && requestedCourse !== String(student.course).trim()) {
        location.replace(redirect);
        return null;
    }

    return student;
}
