"""Small, offline synthetic tests for the Elliptic graph parser."""
import tempfile
import unittest
from pathlib import Path
from scripts.inspect_elliptic import inspect

class EllipticTests(unittest.TestCase):
    def test_edges_and_classes(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            a=root/"elliptic_txs_classes.csv"
            b=root/"elliptic_txs_edgelist.csv"
            output=root/"summary.json"
            a.write_text("txId,class\n1,1\n2,2\n3,unknown\n",encoding="utf-8")
            b.write_text("txId1,txId2\n1,2\n2,3\n5,1\n",encoding="utf-8")
            inspect(a,b,output)
            import json
            data=json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(data["nodes"],3)
            self.assertEqual(data["qualifying_edges"],2)
            self.assertEqual(data["edges_skipped"],1)
            self.assertTrue(data["not_bitcoin_address_attribution"])

if __name__=="__main__":
    unittest.main()
