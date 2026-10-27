-- StockRoom: MySQL schema + seed data
-- Run once:  mysql -u root -p < schema.sql
-- Safe to re-run (uses IF NOT EXISTS / INSERT IGNORE).

CREATE DATABASE IF NOT EXISTS inventory_db
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE inventory_db;

CREATE TABLE IF NOT EXISTS suppliers (
  id     INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name   VARCHAR(120) NOT NULL,
  city   VARCHAR(80)  NOT NULL DEFAULT '',
  phone  VARCHAR(30)  NOT NULL DEFAULT '',
  rating DECIMAL(2,1) NOT NULL DEFAULT 4.0,
  INDEX idx_suppliers_name (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS products (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  sku         VARCHAR(40)  NOT NULL,
  name        VARCHAR(160) NOT NULL,
  category    VARCHAR(80)  NOT NULL,
  supplier_id INT UNSIGNED NOT NULL,
  price       DECIMAL(10,2) NOT NULL CHECK (price >= 0),
  qty         INT NOT NULL DEFAULT 0 CHECK (qty >= 0),
  reorder     INT NOT NULL DEFAULT 10 CHECK (reorder >= 0),
  tags        JSON NOT NULL,
  dim_l       DECIMAL(7,2) NOT NULL DEFAULT 0,
  dim_w       DECIMAL(7,2) NOT NULL DEFAULT 0,
  dim_h       DECIMAL(7,2) NOT NULL DEFAULT 0,
  warehouse   VARCHAR(40)  NOT NULL DEFAULT 'Mumbai-A',
  UNIQUE KEY uq_products_sku (sku),
  INDEX idx_products_category (category),
  CONSTRAINT fk_products_supplier FOREIGN KEY (supplier_id)
    REFERENCES suppliers(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS stock_movements (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  product_id INT UNSIGNED NOT NULL,
  type       ENUM('IN','OUT') NOT NULL,
  qty        INT UNSIGNED NOT NULL,
  moved_on   DATE NOT NULL,
  note       VARCHAR(120) NOT NULL DEFAULT 'manual',
  INDEX idx_movements_product_date (product_id, moved_on),
  CONSTRAINT fk_movements_product FOREIGN KEY (product_id)
    REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------- Seed data ----------
INSERT IGNORE INTO suppliers (id, name, city, phone, rating) VALUES
 (1,'Apex Electronics','Pune','9820011001',4.5),
 (2,'Sai Stationers','Mumbai','9820022002',4.1),
 (3,'Bharat Furnishings','Nashik','9820033003',3.8),
 (4,'Kisan Foods','Thane','9820044004',4.7);

INSERT IGNORE INTO products
 (id, sku, name, category, supplier_id, price, qty, reorder, tags, dim_l, dim_w, dim_h, warehouse) VALUES
 (1,'EL-1001','Wireless Mouse','Electronics',1,699,120,30,'["usb","office","wireless"]',11,6,4,'Mumbai-A'),
 (2,'EL-1002','Mechanical Keyboard','Electronics',1,2999,18,25,'["usb","gaming"]',44,14,4,'Mumbai-A'),
 (3,'EL-1003','27 inch Monitor','Electronics',1,14500,0,10,'["display","office"]',62,20,46,'Pune-B'),
 (4,'ST-2001','A4 Copier Paper Ream','Stationery',2,320,500,100,'["paper","office"]',30,21,5,'Mumbai-A'),
 (5,'ST-2002','Gel Pen Box (10)','Stationery',2,150,60,80,'["pen","office"]',15,8,3,'Mumbai-A'),
 (6,'ST-2003','Whiteboard Marker Set','Stationery',2,240,95,40,'["marker","classroom"]',20,10,3,'Pune-B'),
 (7,'FU-3001','Ergonomic Chair','Furniture',3,8900,14,8,'["office","ergonomic"]',65,65,110,'Pune-B'),
 (8,'FU-3002','Standing Desk','Furniture',3,18900,6,8,'["office","adjustable"]',140,70,120,'Pune-B'),
 (9,'FD-4001','Basmati Rice 5kg','Grocery',4,620,210,60,'["rice","staple"]',35,22,9,'Thane-C'),
 (10,'FD-4002','Cold Pressed Groundnut Oil 1L','Grocery',4,290,44,50,'["oil","staple"]',9,9,26,'Thane-C');

INSERT IGNORE INTO stock_movements (id, product_id, type, qty, moved_on, note) VALUES
 (1,1,'IN',100,'2026-09-02','PO-2201'),
 (2,1,'OUT',35,'2026-09-10','SO-8812'),
 (3,4,'IN',400,'2026-09-05','PO-2202'),
 (4,4,'OUT',120,'2026-09-18','SO-8830'),
 (5,2,'OUT',22,'2026-09-21','SO-8841'),
 (6,9,'IN',250,'2026-09-12','PO-2210'),
 (7,9,'OUT',40,'2026-09-25','SO-8850'),
 (8,7,'OUT',6,'2026-09-27','SO-8855'),
 (9,3,'OUT',12,'2026-09-29','SO-8861'),
 (10,10,'OUT',30,'2026-10-01','SO-8870');
