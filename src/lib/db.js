const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function saveGrants(grants) {
    if (!grants || grants.length === 0) {
        console.log("No new grants to save.");
        return;
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        for (const grant of grants) {
            if (!grant || !grant.url) continue;
            const [rows] = await connection.execute('SELECT id FROM grants WHERE url = ?', [grant.url]);
            if (rows.length > 0) {
                await connection.execute('UPDATE grants SET title = ?, deadline = ?, category = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', 
                [grant.title, grant.deadline, grant.category, rows[0].id]);
            } else {
                await connection.execute(
                    'INSERT INTO grants (title, url, deadline, category) VALUES (?, ?, ?, ?)',
                    [grant.title, grant.url, grant.deadline, grant.category]
                );
            }
        }
        await connection.commit();
        console.log(`Successfully saved ${grants.length} grants.`);
    } catch (error) {
        await connection.rollback();
        console.error('Error saving grants to DB:', error);
        throw error;
    } finally {
        connection.release();
    }
}

async function setupDatabase() {
    const connection = await pool.getConnection();
    try {
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS grants (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                url VARCHAR(2048) NOT NULL UNIQUE,
                deadline VARCHAR(20) DEFAULT 'N/A',
                category VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            );
        `);
        console.log('Database table "grants" is ready.');
    } catch (error) {
        console.error('Error setting up database:', error);
        throw error;
    } finally {
        connection.release();
    }
}

module.exports = { saveGrants, setupDatabase };
