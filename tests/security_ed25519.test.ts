import { generateEd25519Token, verifyEd25519Token } from '../server.ts';

function runSecurityTestSuite() {
  console.log('[TEST] Starting Ed25519 Cryptographic Gatekeeper Test Suite...');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${msg}`);
      failed++;
    }
  }

  // 1. Generate Valid Token
  const ticketId = 'TKT-104';
  const workerId = 'NODE-A8F24C09';
  const epochId = 15;
  const allowedFiles = ['modules/matrimony/ProfileController.php', 'tests/Unit/ProfileTest.php'];
  
  const { tokenHeader, expiresAt } = generateEd25519Token(ticketId, workerId, epochId, allowedFiles, 3600);
  assert(tokenHeader.startsWith('SEC-'), 'Token header starts with SEC- prefix');
  assert(tokenHeader.split('.').length === 2, 'Token structure has <payload>.<signature>');

  // 2. Verify Valid Token
  const resValid = verifyEd25519Token(tokenHeader, ticketId, epochId, allowedFiles);
  assert(resValid.verified === true, 'Valid token passes verification');
  assert(resValid.payload?.ticketId === ticketId, 'Extracted ticket matches');
  assert(resValid.payload?.epochId === epochId, 'Extracted epoch matches');

  // 3. Forged Signature Rejection
  const parts = tokenHeader.replace('SEC-', '').split('.');
  const forgedSig = 'invalid_forged_base64_signature_here';
  const forgedToken = `SEC-${parts[0]}.${forgedSig}`;
  const resForged = verifyEd25519Token(forgedToken, ticketId, epochId, allowedFiles);
  assert(resForged.verified === false, 'Forged signature rejected');
  assert(resForged.error?.includes('403_CRYPTOGRAPHIC_SIGNATURE_MISMATCH') || resForged.error?.includes('signature'), 'Error states signature mismatch');

  // 4. Tampered Payload Rejection
  const tamperedPayloadB64 = Buffer.from(JSON.stringify({
    ticket_id: 'TKT-999_ATTACK',
    worker_id: workerId,
    epoch_id: epochId,
    expiry_timestamp: expiresAt,
    files_hash: 'tampered'
  })).toString('base64url');
  const tamperedToken = `SEC-${tamperedPayloadB64}.${parts[1]}`;
  const resTampered = verifyEd25519Token(tamperedToken, ticketId, epochId, allowedFiles);
  assert(resTampered.verified === false, 'Tampered payload rejected by asymmetric signature');

  // 5. Ticket Mismatch Rejection
  const resMismatch = verifyEd25519Token(tokenHeader, 'TKT-999', epochId, allowedFiles);
  assert(resMismatch.verified === false, 'Mismatched target ticket rejected');
  assert(resMismatch.error?.includes('403_TICKET_MISMATCH') === true, 'Error reports ticket mismatch');

  // 6. Stale Epoch Fencing Rejection
  const resStaleEpoch = verifyEd25519Token(tokenHeader, ticketId, 16, allowedFiles);
  assert(resStaleEpoch.verified === false, 'Stale epoch token rejected');
  assert(resStaleEpoch.error?.includes('403_STALE_EPOCH') === true, 'Error reports stale epoch');

  // 7. Expired Token Rejection
  const expiredTokenObj = generateEd25519Token(ticketId, workerId, epochId, allowedFiles, -10); // already expired 10s ago
  const resExpired = verifyEd25519Token(expiredTokenObj.tokenHeader, ticketId, epochId, allowedFiles);
  assert(resExpired.verified === false, 'Expired token rejected');
  assert(resExpired.error?.includes('403_LEASE_EXPIRED') === true, 'Error reports lease expired');

  // 8. Unauthorized File Boundaries Rejection
  const unauthorizedFiles = ['modules/auth/SecretKeys.php'];
  const resFilesMismatch = verifyEd25519Token(tokenHeader, ticketId, epochId, unauthorizedFiles);
  assert(resFilesMismatch.verified === false, 'Unauthorized files modification rejected');
  assert(resFilesMismatch.error?.includes('403_FILES_HASH_MISMATCH') === true, 'Error reports files hash mismatch');

  console.log(`\n[TEST SUMMARY] Passed: ${passed} | Failed: ${failed}`);
  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runSecurityTestSuite();
