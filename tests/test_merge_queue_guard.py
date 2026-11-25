"""Regression: legacy merge queue must never mutate main directly."""
import tempfile
import unittest
from unittest.mock import patch

from core.merge_queue import MergeQueueEngine


class MergeQueueGuardTests(unittest.TestCase):
    def test_valid_lease_still_cannot_push_or_merge_main(self):
        with tempfile.TemporaryDirectory() as directory:
            queue = MergeQueueEngine(directory, directory + "/pubkey")
            queue.enqueue_ticket("TKT-SECURE", "ai/TKT-SECURE",
                                 "NODE-A", "SEC-signed-token", ["safe.py"])
            with patch("core.merge_queue.CryptoSigner.verify_token_header",
                       return_value=(True, "OK", {"epoch_id": 15})), \
                 patch("subprocess.run") as runner:
                result = queue.process_next(expected_epoch=15)
                self.assertIsNotNone(result)
                self.assertFalse(result.success)
                self.assertIn("GITHUB_REVIEWED_PR_REQUIRED", result.error_message)
                runner.assert_not_called()

    def test_invalid_lease_denies_without_git(self):
        with tempfile.TemporaryDirectory() as directory:
            queue = MergeQueueEngine(directory, directory + "/pubkey")
            queue.enqueue_ticket("TKT-SECURE", "ai/TKT-SECURE",
                                 "NODE-A", "SEC-bad", ["safe.py"])
            with patch("core.merge_queue.CryptoSigner.verify_token_header",
                       return_value=(False, "INVALID", None)), \
                 patch("subprocess.run") as runner:
                result = queue.process_next(expected_epoch=15)
                self.assertIsNotNone(result)
                self.assertFalse(result.success)
                runner.assert_not_called()


if __name__ == "__main__":
    unittest.main()
