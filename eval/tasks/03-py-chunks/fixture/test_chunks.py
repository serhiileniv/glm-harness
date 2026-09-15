import unittest
from chunks import chunks


class ChunksTest(unittest.TestCase):
    def test_even(self):
        self.assertEqual(chunks([1, 2, 3, 4], 2), [[1, 2], [3, 4]])

    def test_uneven(self):
        self.assertEqual(chunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])

    def test_single(self):
        self.assertEqual(chunks([7], 3), [[7]])

    def test_empty(self):
        self.assertEqual(chunks([], 3), [])

    def test_bad_size(self):
        with self.assertRaises(ValueError):
            chunks([1], 0)


if __name__ == "__main__":
    unittest.main()
