# -*- coding: utf-8 -*-
"""轮播视频合成服务 v2（ffmpeg 两阶段串行，低内存）：
   阶段1: 每张图独立 -> 2s 短视频段（scale+pad+fade in/out）
   阶段2: concat demuxer 流复制拼接
用法: python slideshow_service.py <out.mp4> <img1> <img2> ... [--duration 2.0] [--fade 0.5] [--target 1080x1080] [--workdir tmp]
"""
import io, sys, os, subprocess, argparse, tempfile

FFMPEG = r"C:\OzonERP\tools\ffmpeg.exe"

def run(cmd, timeout=300):
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(r.stderr[-1500:])
    return r

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("images", nargs="+")
    ap.add_argument("--duration", type=float, default=2.0)
    ap.add_argument("--fade", type=float, default=0.5)
    ap.add_argument("--target", default="1080x1080")
    ap.add_argument("--workdir", default=r"C:\OzonERP\tmp_slideshow")
    a = ap.parse_args()
    tw, th = a.target.lower().split("x")
    tw, th = int(tw), int(th)
    os.makedirs(a.workdir, exist_ok=True)

    n = len(a.images)
    if n < 1:
        print("need >=1 image"); return 1

    # 阶段1: 逐图生成短视频段
    segs = []
    for i, img in enumerate(a.images):
        seg = os.path.join(a.workdir, f"_seg{i:02d}.mp4")
        f_in = f"fade=t=in:st=0:d={a.fade}" if (i > 0 and a.fade > 0) else ""
        f_out = f"fade=t=out:st={max(0.0, round(a.duration - a.fade, 3))}:d={a.fade}" if a.fade > 0 else ""
        vf = (f"scale={tw}:{th}:force_original_aspect_ratio=decrease,"
              f"pad={tw}:{th}:(ow-iw)/2:(oh-ih)/2,setsar=1")
        if f_in:
            vf += "," + f_in
        vf += "," + f_out
        cmd = [FFMPEG, "-y", "-loop", "1", "-framerate", "25", "-i", img,
               "-vf", vf, "-t", str(a.duration), "-r", "25",
               "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
               "-threads", "1", "-pix_fmt", "yuv420p", seg]
        run(cmd, timeout=180)
        segs.append(seg)

    # 阶段2: concat 流复制拼接
    lst = os.path.join(a.workdir, "_list.txt")
    with open(lst, "w", encoding="utf-8") as f:
        for s in segs:
            f.write(f"file '{s.replace(chr(39), chr(39)+chr(34)+chr(39)+chr(34)+chr(39))}'\n")
    cmd = [FFMPEG, "-y", "-f", "concat", "-safe", "0", "-i", lst,
           "-c", "copy", "-movflags", "+faststart", a.out]
    run(cmd, timeout=180)
    for s in segs:
        try: os.remove(s)
        except Exception: pass
    try: os.remove(lst)
    except Exception: pass
    print("OK", a.out, os.path.getsize(a.out), "bytes")
    return 0

if __name__ == "__main__":
    sys.exit(main())
