const { setupDatabase } = require('./src/lib/db');

async function initialize() {
    console.log('Setting up the database...');
    try {
        await setupDatabase();
        console.log('Database setup complete. You can now start the application.');
        process.exit(0);
    } catch (error) {
        console.error('Failed to setup database:', error);
        process.exit(1);
    }
}

initialize();
