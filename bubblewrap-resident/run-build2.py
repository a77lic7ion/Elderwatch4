#!/usr/bin/env python3
"""Run @bubblewrap/cli update + build via PTY, handling all prompts."""
import pty, os, sys, time, select

os.chdir("/home/shaun/Hermes Projects/Elderwatch4/bubblewrap-project")
JDK = "/usr/lib/jvm/java-17-openjdk"
KS_PASS = "B33tl3sL1lly@123"

def run(cmd, timeout=600):
    print(f"\n=== {' '.join(cmd)} ===", flush=True)
    master, slave = pty.openpty()
    pid = os.fork()
    if pid == 0:
        os.close(master)
        os.dup2(slave, 0); os.dup2(slave, 1); os.dup2(slave, 2)
        if slave > 2: os.close(slave)
        os.execvp("npx", ["npx"] + cmd)
    os.close(slave)
    out = []; start = time.time()
    while time.time() - start < timeout:
        r, _, _ = select.select([master], [], [], 0.3)
        if r:
            try:
                d = os.read(master, 65536)
                if not d: break
                t = d.decode("utf-8", errors="replace")
                sys.stdout.write(t); sys.stdout.flush(); out.append(t)
                # Auto-answer prompts
                if "Y/n" in t and "?" in t and "changes" in t.lower():
                    time.sleep(0.3); os.write(master, b"Y\n")
                    print("[PTY] Y (apply changes)", file=sys.stderr, flush=True)
                elif "Path to your existing JDK" in t:
                    time.sleep(0.3); os.write(master, f"{JDK}\n".encode())
                    print(f"[PTY] JDK path: {JDK}", file=sys.stderr, flush=True)
                elif "Password for the Key Store" in t and "Password for the Key" not in t:
                    time.sleep(0.2); os.write(master, f"{KS_PASS}\n".encode())
                    print("[PTY] Keystore password", file=sys.stderr, flush=True)
                elif "Password for the Key" in t:
                    time.sleep(0.2); os.write(master, f"{KS_PASS}\n".encode())
                    print("[PTY] Key password", file=sys.stderr, flush=True)
            except OSError: break
        pid2, st = os.waitpid(pid, os.WNOHANG)
        if pid2 == pid: break
    os.waitpid(pid, 0)
    ec = os.WEXITSTATUS(st) if os.WIFEXITED(st) else 1
    print(f"\n[PTY] Done: exit={ec}", file=sys.stderr, flush=True)
    return ec

r1 = run(["@bubblewrap/cli", "update", "--appVersionName=1.0.0"], 300)
print(f"\n=== UPDATE: {r1} ===", flush=True)
if r1 == 0:
    r2 = run(["@bubblewrap/cli", "build"], 600)
    print(f"\n=== BUILD: {r2} ===", flush=True)
    sys.exit(r2)
sys.exit(r1)
