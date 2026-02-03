import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS lobbies (
            id uuid PRIMARY KEY,
            code text UNIQUE NOT NULL,
            status text NOT NULL,
            state jsonb NOT NULL,
            turn_started_at timestamptz,
            created_at timestamptz DEFAULT now(),
            updated_at timestamptz DEFAULT now()
        );
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS players (
            id uuid PRIMARY KEY,
            lobby_id uuid REFERENCES lobbies(id) ON DELETE CASCADE,
            player_index int NOT NULL,
            created_at timestamptz DEFAULT now()
        );
    `);
    await pool.end();
}

migrate().catch(() => {
    process.exit(1);
});
