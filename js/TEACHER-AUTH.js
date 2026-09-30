async function getTeacherSession() {
    try {
        const response = await fetch('/api/teacher/session', {
            credentials: 'same-origin',
            cache: 'no-store'
        });

        return await response.json();

    } catch (error) {

        return {
            loggedIn: false,
            teacher: null
        };
    }
}


async function requireTeacherLogin(
    redirect = 'teacher-login.html'
) {

    const session = await getTeacherSession();

    if (!session.loggedIn) {
        location.replace(redirect);
        return null;
    }

    return session.teacher;
}


async function teacherLogin(
    username,
    password
) {

    try {

        const response = await fetch(
            '/api/teacher/login',
            {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    username,
                    password
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {

            return {
                success: false,
                message:
                    data.error ||
                    'Invalid Teacher ID or Password.'
            };
        }

        sessionStorage.setItem(
            'igtrTeacher',
            JSON.stringify(data.teacher)
        );

        return {
            success: true,
            teacher: data.teacher
        };

    } catch (error) {

        return {
            success: false,
            message:
                'Server is not running. Start it with: node server.js'
        };
    }
}


async function teacherLogout() {

    try {

        await fetch(
            '/api/teacher/logout',
            {
                method: 'POST',
                credentials: 'same-origin'
            }
        );

    } catch (error) {
        // Ignore logout network errors.
    }

    sessionStorage.removeItem('igtrTeacher');

    location.replace(
        'teacher-login.html'
    );
}