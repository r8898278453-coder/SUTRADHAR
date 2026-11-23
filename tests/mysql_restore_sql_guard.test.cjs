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
