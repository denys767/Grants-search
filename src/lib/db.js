const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

const pool = mysql.createPool(dbConfig);

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
    const { host, user, password, database } = dbConfig;
    let connection;
    try {
        // Connect without specifying the database
        connection = await mysql.createConnection({ host, user, password });
        
        // Create the database if it doesn't exist
        await connection.execute(`CREATE DATABASE IF NOT EXISTS \`${database}\``);
        console.log(`Database "${database}" is ready.`);
        
        // Close this connection and use the pool for table creation
        await connection.end();

        // Now, get a connection from the pool (which is configured with the database)
        const poolConnection = await pool.getConnection();
        await poolConnection.execute(`
            CREATE TABLE IF NOT EXISTS grants (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                url VARCHAR(2048) NOT NULL,
                deadline VARCHAR(20) DEFAULT 'N/A',
                category VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY url_idx (url(255))
            );
        `);
        console.log('Table "grants" is ready.');
        poolConnection.release();
    } catch (error) {
        console.error('Error setting up database:', error);
        if (connection) await connection.end();
        throw error;
    }
}

async function getGrants({ category = null, page = null, limit = null, sortOrder = 'asc', hideExpired = false } = {}) {
    const connection = await pool.getConnection();
    try {
        console.log('getGrants called with:', { category, page, limit, sortOrder, hideExpired });
        
        // Build base queries
        let baseQuery = 'SELECT * FROM grants';
        let countQuery = 'SELECT COUNT(*) as count FROM grants';
        let whereClause = '';
        const whereParams = [];

        // Add WHERE clause conditions
        const conditions = [];
        
        // Category filter
        if (category && category !== 'all') {
            conditions.push('category = ?');
            whereParams.push(category);
        }
        
        // Hide expired grants filter
        if (hideExpired) {
            conditions.push('(deadline = "N/A" OR STR_TO_DATE(deadline, "%d-%m-%Y") >= CURDATE())');
        }
        
        if (conditions.length > 0) {
            whereClause = ' WHERE ' + conditions.join(' AND ');
        }

        // Execute count query
        const fullCountQuery = countQuery + whereClause;
        console.log('Executing count query:', fullCountQuery, 'with params:', whereParams);
        const [[{ count }]] = await connection.execute(fullCountQuery, whereParams);

        // Build main query with sorting
        const sortDirection = sortOrder === 'asc' ? 'ASC' : 'DESC';
        const orderByClause = `
            ORDER BY 
                CASE WHEN deadline = 'N/A' THEN 1 ELSE 0 END, 
                STR_TO_DATE(deadline, '%d-%m-%Y') ${sortDirection}, 
                created_at DESC
        `;
        let fullQuery = baseQuery + whereClause + orderByClause;
        let mainQueryParams = [...whereParams];

        // Add pagination if needed
        if (page && limit) {
            const pageNum = parseInt(page, 10);
            const limitNum = parseInt(limit, 10);
            const offset = (pageNum - 1) * limitNum;
            fullQuery += ' LIMIT ' + limitNum + ' OFFSET ' + offset;
        }

        console.log('Executing main query:', fullQuery, 'with params:', mainQueryParams);
        const [rows] = await connection.execute(fullQuery, mainQueryParams);

        return { grants: rows, total: count };

    } catch (error) {
        console.error('Error fetching grants from DB:', error);
        throw error;
    } finally {
        connection.release();
    }
}

async function getGrantCategories() {
    const connection = await pool.getConnection();
    try {
        const [rows] = await connection.execute('SELECT DISTINCT category FROM grants WHERE category IS NOT NULL ORDER BY category ASC');
        return rows.map(row => row.category);
    } catch (error) {
        console.error('Error fetching grant categories from DB:', error);
        throw error;
    } finally {
        connection.release();
    }
}

async function getWeeklyGrants() {
    const connection = await pool.getConnection();
    try {
        console.log('Getting grants from the last week...');
        
        // Get grants created in the last 7 days
        const query = `
            SELECT * FROM grants 
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            ORDER BY 
                CASE WHEN deadline = 'N/A' THEN 1 ELSE 0 END, 
                STR_TO_DATE(deadline, '%d-%m-%Y') ASC,
                created_at DESC
        `;
        
        console.log('Executing query:', query);
        const [rows] = await connection.execute(query);
        
        console.log(`Found ${rows.length} grants from the last week`);
        return rows;
    } catch (error) {
        console.error('Error fetching weekly grants from DB:', error);
        throw error;
    } finally {
        connection.release();
    }
}

module.exports = { saveGrants, setupDatabase, getGrants, getGrantCategories, getWeeklyGrants };
