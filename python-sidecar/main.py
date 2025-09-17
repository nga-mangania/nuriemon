#!/usr/bin/env python3
import sys
import json
import base64
import io
from rembg import remove, new_session
from PIL import Image, ImageEnhance
import cv2
import numpy as np

# セッションを初期化（起動時に一度だけ）
session = new_session("u2net")

def enhance_contrast(image, factor=1):
    enhancer = ImageEnhance.Contrast(image)
    return enhancer.enhance(factor)

def enhance_sharpness(image, factor=2.0):
    enhancer = ImageEnhance.Sharpness(image)
    return enhancer.enhance(factor)

def remove_noise(image):
    open_cv_image = np.array(image)
    denoised = cv2.medianBlur(open_cv_image, 5)
    return Image.fromarray(denoised)


def trim_transparent_borders(image, padding: int = 4, alpha_threshold: int = 8) -> Image.Image:
    """Crop away fully transparent edges to make the subject fill the canvas."""
    if image.mode != 'RGBA':
        image = image.convert('RGBA')

    arr = np.array(image)
    if arr.shape[-1] < 4:
        return image

    alpha = arr[:, :, 3]
    mask = alpha > alpha_threshold
    if not np.any(mask):
        return image

    ys, xs = np.where(mask)
    top = max(int(ys.min()) - padding, 0)
    bottom = min(int(ys.max()) + padding, arr.shape[0] - 1)
    left = max(int(xs.min()) - padding, 0)
    right = min(int(xs.max()) + padding, arr.shape[1] - 1)

    # right/lower are exclusive in PIL's crop arguments
    if top == 0 and left == 0 and bottom == arr.shape[0] - 1 and right == arr.shape[1] - 1:
        return image

    return image.crop((left, top, right + 1, bottom + 1))

def preprocess_image(image):
    image = convert_background_to_white(image)
    image = enhance_contrast(image, factor=1.0)
    image = enhance_sharpness(image, factor=1.2)
    image = remove_noise(image)
    return image

def convert_background_to_white(image):
    open_cv_image = np.array(image.convert('RGB'))
    lab = cv2.cvtColor(open_cv_image, cv2.COLOR_RGB2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)

    # CLAHEによるコントラスト制御
    clahe = cv2.createCLAHE(clipLimit=1.0, tileGridSize=(4,4))
    cl = clahe.apply(l_channel)

    merged = cv2.merge((cl, a_channel, b_channel))
    result = cv2.cvtColor(merged, cv2.COLOR_LAB2RGB)
    return Image.fromarray(result)

def create_custom_mask(image):
    open_cv_image = np.array(image.convert('RGB'))
    gray = cv2.cvtColor(open_cv_image, cv2.COLOR_RGB2GRAY)

    # グローバル閾値処理で線画を強調
    _, thresh = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)

    # 形態学的処理で線を太くする
    kernel = np.ones((3, 3), np.uint8)
    dilated = cv2.dilate(thresh, kernel, iterations=1)

    # マスクを作成
    mask = Image.fromarray(dilated)
    return mask

def process_image(base64_image):
    try:
        print(json.dumps({"type": "progress", "value": 10}), flush=True)
        # Base64をデコード
        image_data = base64.b64decode(base64_image.split(',')[1] if ',' in base64_image else base64_image)
        
        print(json.dumps({"type": "progress", "value": 20}), flush=True)
        # PILイメージとして開く
        input_image = Image.open(io.BytesIO(image_data)).convert("RGB")
        
        # 前処理を適用
        input_image = preprocess_image(input_image)
        print(json.dumps({"type": "progress", "value": 40}), flush=True)
        
        # 画像サイズを制限
        max_size = 1024
        if max(input_image.size) > max_size:
            input_image.thumbnail((max_size, max_size), Image.LANCZOS)
        
        # カスタムマスクを生成
        custom_mask = create_custom_mask(input_image)
        print(json.dumps({"type": "progress", "value": 60}), flush=True)
        
        # 背景を削除
        output = remove(
            input_image,
            session=session,
            alpha_matting=True,
            alpha_matting_foreground_threshold=220,
            alpha_matting_background_threshold=20,
            alpha_matting_erode_size=10,
            mask=custom_mask
        )
        output = trim_transparent_borders(output)
        print(json.dumps({"type": "progress", "value": 95}), flush=True)
        
        # 結果をBase64に変換
        output_buffer = io.BytesIO()
        output.save(output_buffer, format='PNG')
        output_buffer.seek(0)
        output_base64 = base64.b64encode(output_buffer.getvalue()).decode('utf-8')
        
        print(json.dumps({"type": "progress", "value": 100}), flush=True)
        
        result = {
            "type": "result",
            "success": True,
            "image": f"data:image/png;base64,{output_base64}"
        }
        return result
        
    except Exception as e:
        return {
            "type": "result",
            "success": False,
            "error": str(e)
        }

def main():
    # 標準入力からJSONを読み込み、常駐で処理
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        try:
            data = json.loads(line.strip())
            cmd = data.get("command")

            if cmd == "process":
                result = process_image(data.get("image", ""))
                print(json.dumps(result), flush=True)
                sys.stdout.flush()
            elif cmd == "health" or cmd == "warmup":
                print(json.dumps({"success": True, "status": "ready"}), flush=True)
            elif cmd == "shutdown":
                print(json.dumps({"success": True, "status": "bye"}), flush=True)
                sys.stdout.flush()
                break
        except Exception as e:
            print(json.dumps({"type": "result", "success": False, "error": str(e)}), flush=True)
            sys.stdout.flush()

if __name__ == "__main__":
    main()
