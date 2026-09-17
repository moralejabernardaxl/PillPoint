// db/database.js
// Sets up (and if needed, creates + seeds) the SQLite database.
// Using better-sqlite3: a real embedded SQL database (single file: pillpoint.db)
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'pillpoint.db');
const isNew = !fs.existsSync(DB_PATH);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('customer','pharmacy_staff','admin')),
  pharmacy_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id)
);

CREATE TABLE IF NOT EXISTS pharmacies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  phone TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  store_image TEXT,
  description TEXT,
  hours TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS medicines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT,
  description TEXT
);

-- Folders let a pharmacy group products together and deploy/undeploy them as
-- one unit, instead of toggling visibility per product.
CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','ready','deployed','archived')),
  deployed_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id)
);

CREATE TABLE IF NOT EXISTS inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER NOT NULL,
  medicine_id INTEGER NOT NULL,
  folder_id INTEGER,
  price REAL NOT NULL,
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  low_stock_threshold INTEGER NOT NULL DEFAULT 10,
  brand TEXT,
  deployed INTEGER NOT NULL DEFAULT 0,
  deployed_at TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id),
  FOREIGN KEY (medicine_id) REFERENCES medicines(id),
  FOREIGN KEY (folder_id) REFERENCES folders(id),
  UNIQUE(pharmacy_id, medicine_id)
);

-- Log of every deploy/undeploy action, used for the "recent deploy history" panel.
CREATE TABLE IF NOT EXISTS deploy_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER NOT NULL,
  inventory_id INTEGER NOT NULL,
  medicine_name TEXT NOT NULL,
  brand TEXT,
  price REAL NOT NULL,
  stock_quantity INTEGER NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('deployed','undeployed')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id)
);

-- Deployment history is now recorded at the folder level (a folder deploy
-- publishes every product inside it in one action).
CREATE TABLE IF NOT EXISTS folder_deploy_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER NOT NULL,
  folder_id INTEGER NOT NULL,
  folder_name TEXT NOT NULL,
  product_count INTEGER NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('deployed','undeployed')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id),
  FOREIGN KEY (folder_id) REFERENCES folders(id)
);

CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  inventory_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','completed','cancelled')),
  reserved_at TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  FOREIGN KEY (customer_id) REFERENCES users(id),
  FOREIGN KEY (inventory_id) REFERENCES inventory(id)
);

CREATE TABLE IF NOT EXISTS search_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  query TEXT,
  category TEXT,
  medicine_ids TEXT NOT NULL DEFAULT '[]',
  pharmacy_ids TEXT NOT NULL DEFAULT '[]',
  result_count INTEGER NOT NULL DEFAULT 0,
  searched_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'info',
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
`);

// Lightweight migration: if this is an existing pre-deploy-feature database,
// add the new inventory columns instead of forcing a full reseed.
const inventoryCols = db.prepare("PRAGMA table_info(inventory)").all().map(c => c.name);
if (!inventoryCols.includes('brand')) db.exec("ALTER TABLE inventory ADD COLUMN brand TEXT");
if (!inventoryCols.includes('deployed')) db.exec("ALTER TABLE inventory ADD COLUMN deployed INTEGER NOT NULL DEFAULT 0");
if (!inventoryCols.includes('deployed_at')) db.exec("ALTER TABLE inventory ADD COLUMN deployed_at TEXT");
if (!inventoryCols.includes('folder_id')) db.exec("ALTER TABLE inventory ADD COLUMN folder_id INTEGER REFERENCES folders(id)");

const pharmacyCols = db.prepare("PRAGMA table_info(pharmacies)").all().map(c => c.name);
if (!pharmacyCols.includes('store_image')) db.exec("ALTER TABLE pharmacies ADD COLUMN store_image TEXT");
if (!pharmacyCols.includes('description')) db.exec("ALTER TABLE pharmacies ADD COLUMN description TEXT");
if (!pharmacyCols.includes('hours')) db.exec("ALTER TABLE pharmacies ADD COLUMN hours TEXT");

if (isNew) {
  console.log('New database detected — seeding sample data...');
  require('./seed')(db, bcrypt);
}

module.exports = db;
