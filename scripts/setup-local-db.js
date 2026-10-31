import { Client } from 'pg';

const ADMIN = {
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'admin',
  database: 'postgres',
};

async function query(sql, params = []) {
  const c = new Client(ADMIN);
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

async function ensureDb(name) {
  const { rows } = await query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (rows.length === 0) {
    await query(`CREATE DATABASE "${name}"`);
    console.log(`Created database ${name}`);
  } else {
    console.log(`Database ${name} already exists`);
  }
}

async function main() {
  await ensureDb('ju_meal');
  await ensureDb('ju_meal_test');
  // Ensure ju_meal user exists for local dev
  try {
    await query(
      "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ju_meal') THEN CREATE ROLE ju_meal LOGIN PASSWORD 'ju_meal_dev_password'; END IF; END $$;",
    );
    console.log('Ensured role ju_meal');
  } catch (e) {
    console.warn('role ensure warning:', e.message);
  }
  await query('GRANT ALL PRIVILEGES ON DATABASE ju_meal TO ju_meal');
  await query('GRANT ALL PRIVILEGES ON DATABASE ju_meal_test TO ju_meal');
  console.log('Done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
