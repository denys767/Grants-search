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

// Helper function to convert dd-mm-yyyy to MySQL DATE format
function convertDeadlineToDate(deadlineStr) {
    if (!deadlineStr || deadlineStr === 'N/A' || deadlineStr.trim() === '') {
        return null;
    }
    
    try {
        // Parse dd-mm-yyyy format
        const parts = deadlineStr.split('-');
        if (parts.length === 3) {
            const day = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10);
            const year = parseInt(parts[2], 10);
            
            // Validate the parsed values
            if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2000) {
                // Create date string directly in YYYY-MM-DD format to avoid timezone issues
                // Pad single digits with zeros
                const paddedMonth = month.toString().padStart(2, '0');
                const paddedDay = day.toString().padStart(2, '0');
                return `${year}-${paddedMonth}-${paddedDay}`;
            }
        }
    } catch (error) {
        console.warn('Error parsing deadline:', deadlineStr, error.message);
    }
    
    return null;
}

async function saveGrants(grants) {
    if (!grants || grants.length === 0) {
        console.log("💾 [DATABASE] No new grants to save.");
        return [];
    }

    console.log(`💾 [DATABASE] Starting to save ${grants.length} grants...`);
    const connection = await pool.getConnection();
    const newlyInserted = [];
    try {
        await connection.beginTransaction();
        let savedCount = 0;
        let skippedExpiredCount = 0;
        let updatedCount = 0;
        
        const SOON_DAYS_THRESHOLD = 10; // Менше ніж за 10 днів переносимо в rejected
        console.log(`📅 [DATABASE] Using ${SOON_DAYS_THRESHOLD} days threshold for soon-expiring grants`);

        for (const grant of grants) {
            if (!grant || !grant.url) {
                console.warn(`⚠️ [DATABASE] Skipping invalid grant (missing URL or data)`);
                continue;
            }
            
            console.log(`🔍 [DATABASE] Processing grant: "${grant.title}" from ${grant.url}`);
            
            const deadlineDate = convertDeadlineToDate(grant.deadline);
            console.log(`📅 [DATABASE] Converted deadline "${grant.deadline}" → ${deadlineDate || 'NULL'}`);
            
            // Перевірка дедлайну: прострочені та ті що менш ніж за 10 днів заносимо у rejected_grants
            if (deadlineDate) {
                const today = new Date();
                today.setHours(0,0,0,0);
                const deadline = new Date(deadlineDate);
                deadline.setHours(0,0,0,0);
                const diffMs = deadline - today; // може бути від'ємним
                const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

                if (diffDays < 0) {
                    // Прострочений
                    console.log(`❌ [DATABASE] Moving expired grant to rejected: ${grant.title} (deadline: ${deadlineDate}, expired ${Math.abs(diffDays)} days ago)`);
                    skippedExpiredCount++;
                    await saveRejectedGrant(grant.url, grant.title || null, 'expired_deadline');
                    continue;
                } else if (diffDays < SOON_DAYS_THRESHOLD) {
                    console.log(`⚠️ [DATABASE] Moving soon-expiring (<${SOON_DAYS_THRESHOLD}d) grant to rejected: ${grant.title} (deadline: ${deadlineDate}, in ${diffDays}d)`);
                    skippedExpiredCount++;
                    await saveRejectedGrant(grant.url, grant.title || null, `deadline_less_than_${SOON_DAYS_THRESHOLD}_days`);
                    continue;
                } else {
                    console.log(`✅ [DATABASE] Grant deadline is valid: ${diffDays} days from now`);
                }
            } else {
                console.log(`📅 [DATABASE] Grant has no deadline (open-ended)`);
            }
            
            const [rows] = await connection.execute('SELECT id FROM grants WHERE url = ?', [grant.url]);
            if (rows.length > 0) {
                // Existing grant -> update
                console.log(`🔄 [DATABASE] Updating existing grant (ID: ${rows[0].id})`);
                await connection.execute(
                    'UPDATE grants SET title = ?, deadline = ?, category = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', 
                    [grant.title, deadlineDate, grant.category, rows[0].id]
                );
                updatedCount++;
            } else {
                // New grant -> insert & track for immediate notification
                console.log(`➕ [DATABASE] Inserting new grant into database`);
                await connection.execute(
                    'INSERT INTO grants (title, url, deadline, category) VALUES (?, ?, ?, ?)',
                    [grant.title, grant.url, deadlineDate, grant.category]
                );
                const newGrant = {
                    title: grant.title,
                    url: grant.url,
                    deadline: deadlineDate,
                    category: grant.category
                };
                newlyInserted.push(newGrant);
                console.log(`✅ [DATABASE] Added to new grants list for notification: "${grant.title}"`);
            }
            savedCount++;
        }
        await connection.commit();
        console.log(`✅ [DATABASE] Transaction completed successfully`);
        console.log(`📊 [DATABASE] Final results:`);
        console.log(`   • Total processed: ${grants.length}`);
        console.log(`   • Successfully saved: ${savedCount}`);
        console.log(`   • Updated existing: ${updatedCount}`);
        console.log(`   • New inserts: ${newlyInserted.length}`);
        console.log(`   • Skipped (expired/soon): ${skippedExpiredCount}`);
        
        return newlyInserted;
    } catch (error) {
        await connection.rollback();
        console.error('❌ [DATABASE] Error saving grants to DB:', error);
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
                deadline DATE NULL DEFAULT NULL,
                category VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY url_idx (url(255))
            );
        `);
        console.log('Table "grants" is ready.');
        
        // Create rejected grants table
        await poolConnection.execute(`
            CREATE TABLE IF NOT EXISTS rejected_grants (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NULL,
                url VARCHAR(2048) NOT NULL,
                rejection_reason VARCHAR(255) NOT NULL,
                extracted_text TEXT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY url_idx (url(255))
            );
        `);
        console.log('Table "rejected_grants" is ready.');
        
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
            // Приховуємо дедлайни що вже минули або настануть менш ніж за 10 днів
            // Показуємо тільки ті що безстрокові або дедлайн >= сьогодні + 10 днів
            conditions.push('(deadline IS NULL OR deadline >= DATE_ADD(CURDATE(), INTERVAL 10 DAY))');
        }
        
        if (conditions.length > 0) {
            whereClause = ' WHERE ' + conditions.join(' AND ');
        }

        // Execute count query
        const fullCountQuery = countQuery + whereClause;
        const [[{ count }]] = await connection.execute(fullCountQuery, whereParams);

        // Build main query with sorting
        const sortDirection = sortOrder === 'asc' ? 'ASC' : 'DESC';
        const orderByClause = `
            ORDER BY 
                CASE WHEN deadline IS NULL THEN 1 ELSE 0 END, 
                deadline ${sortDirection}, 
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

        const [rows] = await connection.execute(fullQuery, mainQueryParams);
        return { grants: rows, total: count };

    } catch (error) {
        console.error('Error fetching grants from database:', error.message);
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

async function saveRejectedGrant(url, title = null, rejectionReason, extractedText = null) {
    const connection = await pool.getConnection();
    try {
        // Check if this URL is already in rejected grants
        const [existing] = await connection.execute(
            'SELECT id FROM rejected_grants WHERE url = ?', 
            [url]
        );
        
        if (existing.length > 0) {
            console.log(`🚫 URL already in rejected grants: ${url}`);
            return;
        }
        
        // Insert the rejected grant
        await connection.execute(
            'INSERT INTO rejected_grants (url, title, rejection_reason, extracted_text) VALUES (?, ?, ?, ?)',
            [url, title, rejectionReason, extractedText]
        );
        
        console.log(`🚫 Saved rejected grant: ${url} (Reason: ${rejectionReason})`);
        
    } catch (error) {
        console.error('Error saving rejected grant:', error.message);
    } finally {
        connection.release();
    }
}

async function getRejectedUrls(urls) {
    if (!urls || urls.length === 0) {
        return new Set();
    }

    const connection = await pool.getConnection();
    try {
        // Create placeholders for IN clause
        const placeholders = urls.map(() => '?').join(',');
        const query = `SELECT url FROM rejected_grants WHERE url IN (${placeholders})`;
        
        const [rows] = await connection.execute(query, urls);
        
        // Return a Set of rejected URLs for fast lookup
        const rejectedUrls = new Set(rows.map(row => row.url));
        
        console.log(`🚫 Checked ${urls.length} URLs, found ${rejectedUrls.size} previously rejected`);
        return rejectedUrls;
    } catch (error) {
        console.error('Error checking rejected URLs:', error.message);
        return new Set(); // Return empty set on error
    } finally {
        connection.release();
    }
}

async function getExistingUrls(urls) {
    if (!urls || urls.length === 0) {
        return new Set();
    }

    const connection = await pool.getConnection();
    try {
        // Create placeholders for IN clause
        const placeholders = urls.map(() => '?').join(',');
        
        // Check both grants and rejected_grants tables
        const grantQuery = `SELECT url FROM grants WHERE url IN (${placeholders})`;
        const rejectedQuery = `SELECT url FROM rejected_grants WHERE url IN (${placeholders})`;
        
        const [grantRows] = await connection.execute(grantQuery, urls);
        const [rejectedRows] = await connection.execute(rejectedQuery, urls);
        
        // Combine both sets
        const existingUrls = new Set([
            ...grantRows.map(row => row.url),
            ...rejectedRows.map(row => row.url)
        ]);
        
        console.log(`🔍 Checked ${urls.length} URLs:`);
        console.log(`   • In grants table: ${grantRows.length}`);
        console.log(`   • In rejected_grants table: ${rejectedRows.length}`);
        console.log(`   • Total to skip: ${existingUrls.size}`);
        
        return existingUrls;
    } catch (error) {
        console.error('Error checking existing URLs:', error.message);
        return new Set(); // Return empty set on error, so scraping continues
    } finally {
        connection.release();
    }
}

async function getRejectedGrants({ limit = 50 } = {}) {
    const connection = await pool.getConnection();
    try {
        const query = `
            SELECT url, title, rejection_reason, created_at 
            FROM rejected_grants 
            ORDER BY created_at DESC 
            LIMIT ?
        `;
        
        const [rows] = await connection.execute(query, [limit]);
        return rows;
    } catch (error) {
        console.error('Error fetching rejected grants:', error.message);
        throw error;
    } finally {
        connection.release();
    }
}

async function getWeeklyGrants() {
    const connection = await pool.getConnection();
    try {
        // Get grants created in the last 7 days
        const query = `
            SELECT * FROM grants 
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            ORDER BY 
                CASE WHEN deadline IS NULL THEN 1 ELSE 0 END, 
                deadline ASC,
                created_at DESC
        `;
        
        const [rows] = await connection.execute(query);
        return rows;
    } catch (error) {
        console.error('Error fetching weekly grants:', error.message);
        throw error;
    } finally {
        connection.release();
    }
}

async function cleanupExpiredGrants() {
    const connection = await pool.getConnection();
    try {
        // Видаляємо гранти з минулим дедлайном
        const query = `
            DELETE FROM grants 
            WHERE deadline IS NOT NULL 
            AND deadline < CURDATE()
        `;
        
        const [result] = await connection.execute(query);
        const deletedCount = result.affectedRows;
        
        if (deletedCount > 0) {
            console.log(`🗑️ Cleaned up ${deletedCount} expired grants from database`);
        } else {
            console.log(`✅ No expired grants found to clean up`);
        }
        
        return deletedCount;
    } catch (error) {
        console.error('Error cleaning up expired grants:', error.message);
        throw error;
    } finally {
        connection.release();
    }
}

module.exports = { 
    saveGrants, 
    setupDatabase, 
    getGrants, 
    getGrantCategories, 
    getWeeklyGrants, 
    getExistingUrls, 
    saveRejectedGrant, 
    getRejectedUrls,
    getRejectedGrants,
    cleanupExpiredGrants
};
