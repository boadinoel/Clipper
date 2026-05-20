#!/usr/bin/env python3
"""
Face-track sidecar.

Reads a video file, samples every Nth frame with MediaPipe FaceMesh,
and writes a JSON sidecar describing the face center per sample.

Usage:
  face-track.py --input <path> --out <path> [--every 5] [--max-frames 0]

Output JSON shape:
{
  "fps": float,
  "width": int,
  "height": int,
  "frame_count": int,
  "samples": [
    {"frame": int, "t": float, "cx": float, "cy": float, "conf": float}
  ]
}

Exit codes:
  0 = success
  1 = invalid args / file not openable
  2 = mediapipe unavailable
"""

import argparse
import json
import sys

try:
    import cv2  # type: ignore
    import mediapipe as mp  # type: ignore
except Exception as exc:  # pragma: no cover - install-time error
    sys.stderr.write(f"face-track: missing deps: {exc}\n")
    sys.exit(2)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--every", type=int, default=5)
    p.add_argument("--max-frames", type=int, default=0)
    args = p.parse_args()

    cap = cv2.VideoCapture(args.input)
    if not cap.isOpened():
        sys.stderr.write(f"face-track: cannot open {args.input}\n")
        return 1

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)

    samples = []
    frame_idx = 0
    detector = mp.solutions.face_detection.FaceDetection(
        model_selection=1, min_detection_confidence=0.5
    )

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if frame_idx % max(1, args.every) == 0:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            result = detector.process(rgb)
            if result.detections:
                best = max(
                    result.detections,
                    key=lambda d: d.score[0] if d.score else 0.0,
                )
                box = best.location_data.relative_bounding_box
                cx = float(box.xmin + box.width / 2.0)
                cy = float(box.ymin + box.height / 2.0)
                conf = float(best.score[0] if best.score else 0.0)
                samples.append(
                    {
                        "frame": frame_idx,
                        "t": float(frame_idx / fps),
                        "cx": cx,
                        "cy": cy,
                        "conf": conf,
                    }
                )
        frame_idx += 1
        if args.max_frames and frame_idx >= args.max_frames:
            break

    cap.release()
    detector.close()

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(
            {
                "fps": fps,
                "width": width,
                "height": height,
                "frame_count": frame_count,
                "samples": samples,
            },
            fh,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
