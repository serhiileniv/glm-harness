def chunks(items, size):
    """Split items into consecutive lists of at most `size` elements. The last chunk may be shorter."""
    if size <= 0:
        raise ValueError("size must be positive")
    out = []
    for i in range(0, len(items) - 1, size):
        out.append(items[i:i + size])
    return out
