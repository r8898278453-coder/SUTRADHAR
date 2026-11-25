'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validateRestoreSql}=require('../scripts/ops/restore-sql-guard.cjs');
const q=String.fromCharCode(96);
const normal=[
  '-- Standard mysqldump comment, USE here is not executed',
  '/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;',
  'CREATE TABLE '+q+'v7_ledger'+q+' ('+q+'id'+q+' bigint NOT NULL, '+q+'notes'+q+' text);',
  "INSERT INTO v7_ledger VALUES (1,'USE production_db; DROP DATABASE production_db;');",
  '/*!40000 ALTER TABLE v7_ledger DISABLE KEYS */;',
  '/*!40000 ALTER TABLE v7_ledger ENABLE KEYS */;',
  'DELIMITER ;;',
  '/*!50003 CREATE*/ /*!50017 DEFINER='+q+'backup_user'+q+'@'+q+'%'+q+'*/ /*!50003 TRIGGER v7_test AFTER INSERT ON v7_ledger FOR EACH ROW SET @audit = 1 */;;',
  'DELIMITER ;'
].join('\n')+'\n';
test('normal single-schema dump comments, triggers and literals are accepted',()=>{
  const result=validateRestoreSql(Buffer.from(normal));
  assert.equal(result.accepted,true);
  assert.equal(result.db_permissions_verified,false);
});
test('direct, prefixed and executable-comment schema switches are blocked',()=>{
  const bad=[
    'USE prod;','CREATE DATABASE prod;','DROP DATABASE prod;',
    'ALTER SCHEMA prod;','RENAME DATABASE prod TO prod2;',
    '/* prefix */ USE prod;','/*!50000 USE prod */;',
    '/*!50000 DROP DATABASE prod */;','CREATE /*x*/ DATABASE prod;',
    'SOURCE /tmp/file.sql;','SYSTEM id;','\\! whoami',
    '\\. /tmp/file.sql','GRANT ALL ON *.* TO admin;',
    'REVOKE ALL PRIVILEGES ON *.* FROM admin;',
    "CREATE USER admin IDENTIFIED BY 'x';",'FLUSH PRIVILEGES;',
    'SET GLOBAL sql_log_bin=0;','RESET MASTER;'
  ];
  for(const sql of bad)
    assert.throws(()=>validateRestoreSql(Buffer.from(sql+'\n'+normal)),
      /BACKUP_HAS_DATABASE_SWITCH_OR_DROP/,sql);
});
test('inert comments and string contents do not trigger false positives',()=>{
  const allowed=[
    '-- DROP DATABASE hidden;',
    '# USE hidden;',
    '/* CREATE DATABASE hidden */',
    "INSERT INTO v7_ledger VALUES(2,'DROP DATABASE hidden;');"
  ].join('\n');
  assert.equal(validateRestoreSql(Buffer.from(normal+allowed)).accepted,true);
});
test('invalid UTF-8, partial quoted values and partial comments fail closed',()=>{
  for(const bytes of [
    Buffer.from(normal+"INSERT INTO x VALUES ('broken"),
    Buffer.from(normal+'/* incomplete'),
    Buffer.from(normal+'/*!50000 SET @broken=1'),
    Buffer.concat([Buffer.from(normal),Buffer.from([0xc3,0x28])]),
    Buffer.alloc(10)
  ])assert.throws(()=>validateRestoreSql(bytes),/BACKUP_HAS_DATABASE_SWITCH_OR_DROP/);
});

test('schema-qualified object references fail closed without USE',()=>{
  const escapes=[
    'DROP TABLE production_db.users;',
    'DROP TABLE IF EXISTS production_db.users;',
    'CREATE TABLE production_db.users (id INT);',
    'INSERT INTO production_db.users VALUES (1);',
    'REPLACE INTO production_db.users VALUES (1);',
    'UPDATE production_db.users SET id = 0;',
    'DELETE FROM production_db.users;',
    'SELECT * FROM production_db.users;',
    'SELECT * FROM local JOIN production_db.users ON local.id = 1;',
    'TRUNCATE TABLE production_db.users;',
    'RENAME TABLE local TO production_db.users;',
    'CALL production_db.cleanup();',
    'CREATE INDEX idx ON production_db.users(id);',
    'CREATE TRIGGER t BEFORE INSERT ON production_db.users FOR EACH ROW SET @a = 1;',
    '/*!50000 DROP TABLE production_db.users */;',
    'DROP TABLE \x60production_db\x60.\x60users\x60;',
    'INSERT INTO \x60production_db\x60 . \x60users\x60 VALUES (1);',
    'DROP TABLE IF EXISTS /* comment */ \x60production_db\x60.\x60users\x60;'
  ];
  for(const sql of escapes)
    assert.throws(()=>validateRestoreSql(Buffer.from(sql+'\n'+normal)),
      /BACKUP_HAS_DATABASE_SWITCH_OR_DROP/,sql);
});
test('qualified column expressions and trigger NEW.field are not schema-qualified table names',()=>{
  const sql=normal+
    '\nSELECT x.id FROM v7_ledger AS x WHERE x.id = 1;'+
    '\nCREATE TRIGGER t BEFORE INSERT ON v7_ledger FOR EACH ROW SET NEW.id = NEW.id + 1;\n';
  assert.equal(validateRestoreSql(Buffer.from(sql)).accepted,true);
});
