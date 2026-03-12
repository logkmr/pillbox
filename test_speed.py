import time
import cv2
import numpy as np
import os
from pylibdmtx.pylibdmtx import decode as decode_dmtx

def test_speed():
    # Create a dummy image with a data matrix if possible, or just a large blank one
    img = np.zeros((3000, 4000, 3), dtype=np.uint8)
    cv2.putText(img, "TEST", (100, 100), cv2.FONT_HERSHEY_SIMPLEX, 2, (255, 255, 255), 2)
    
    start = time.time()
    print("Decoding large image...")
    decode_dmtx(img)
    print(f"Time for 4000x3000: {time.time() - start:.2f}s")
    
    img_small = cv2.resize(img, (1000, 750))
    start = time.time()
    print("Decoding 1000x750 image...")
    decode_dmtx(img_small)
    print(f"Time for 1000x750: {time.time() - start:.2f}s")

if __name__ == "__main__":
    test_speed()
