import unittest
from python_adapter import references
class References(unittest.TestCase):
 def test_reads_writes_and_shadowing(self):
  code='amount = 30\namount = amount - 20\ndef other():\n    amount = 99\n    return amount\n'
  result=references(code,1,2)
  self.assertEqual(result['version'],'0.20.1')
  self.assertEqual([(r['line'],r['definition']) for r in result['references']],[(1,True),(2,False),(2,True)])
if __name__=='__main__':unittest.main()
