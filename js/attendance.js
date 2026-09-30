async function getAttendance(student) {

    try {

        const response = await fetch(
            '/api/attendance/my',
            {
                credentials: 'same-origin',
                cache: 'no-store'
            }
        );

        if (!response.ok) {

            return {
                total: 0,
                present: 0,
                absent: 0,
                required: 75,
                percentage: 0,
                updatedAt: null,
                subjects: [],
                recent: []
            };
        }

        const data = await response.json();

        return data.overall || {
            total: 0,
            present: 0,
            absent: 0,
            required: 75,
            percentage: 0,
            updatedAt: null,
            subjects: [],
            recent: []
        };

    } catch (error) {

        return {
            total: 0,
            present: 0,
            absent: 0,
            required: 75,
            percentage: 0,
            updatedAt: null,
            subjects: [],
            recent: []
        };
    }
}


async function getAttendanceDetails() {

    try {

        const response = await fetch(
            '/api/attendance/my',
            {
                credentials: 'same-origin',
                cache: 'no-store'
            }
        );

        if (!response.ok) {
            return null;
        }

        return await response.json();

    } catch (error) {

        return null;
    }
}


function attendancePercentage(data) {

    const total =
        Number(data?.total || 0);

    const present =
        Number(data?.present || 0);

    if (total <= 0) {
        return 0;
    }

    return (present / total) * 100;
}