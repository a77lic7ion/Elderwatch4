#!/usr/bin/env python3
"""Run @bubblewrap/cli update + build with a pseudo-terminal to handle prompts."""
import pty
import os
import sys
import time
import select

TARGET_DIR = "/home/shaun/Hermes Projects/Elderwatch4/bubblewrap-resident"
os.chdir(TARGET_DIR)

JDK_PATH = "/usr/lib/jvm/java-17-openjdk"

def run_command(cmd_args, send_jdk=True):
    print(f"\n=== RUNNING: {' '.join(cmd_args)} ===", flush=True)
    master_fd, slave_fd = pty.openpty()
    pid = os.fork()
    
    if pid == 0:
        os.close(master_fd)
        os.dup2(slave_fd, 0)
        os.dup2(slave_fd, 1)
        os.dup2(slave_fd, 2)
        if slave_fd > 2:
            os.close(slave_fd)
        os.execvp("npx", ["npx"] + cmd_args)
    else:
        os.close(slave_fd)
        sent_n = False
        sent_jdk = False
        start = time.time()
        timeout = 300
        
        while time.time() - start < timeout:
            r, _, _ = select.select([master_fd], [], [], 0.5)
            if r:
                try:
                    data = os.read(master_fd, 65536)
                    if not data:
                        break
                    text = data.decode("utf-8", errors="replace")
                    sys.stdout.write(text)
                    sys.stdout.flush()
                    
                    if not sent_n and ("Y/n" in text or "y/n" in text.lower()) and "?" in text:
                        time.sleep(0.3)
                        os.write(master_fd, b"Y\n")
                        sent_n = True
                        print("\n[PTY] Sent: Y (auto-accept)", file=sys.stderr, flush=True)
                    
                    if sent_n and send_jdk and not sent_jdk and "Path to your existing JDK" in text:
                        time.sleep(0.3)
                        os.write(master_fd, f"{JDK_PATH}\n".encode())
                        sent_jdk = True
                        print(f"[PTY] Sent: {JDK_PATH}", file=sys.stderr, flush=True)
                        
                    # Handle password prompts
                    if "Password" in text and "Key Store" in text:
                        time.sleep(0.3)
                        os.write(master_fd, b"B33tl3sL1lly@123\n")
                        print("[PTY] Sent: keystore password", file=sys.stderr, flush=True)
                    elif "Password" in text and "alias" in text.lower():
                        time.sleep(0.3)
                        # After keystore password, the next prompt is alias password
                        # We need to wait for the alias prompt
                        pass
                        
                except OSError:
                    break
        
        try:
            os.waitpid(pid, 0)
        except ChildProcessError:
            pass
        
        exit_code = 0
        try:
            if os.WIFEXITED(status):
                exit_code = os.WEXITSTATUS(status)
        except:
            pass
        
        print(f"\n[PTY] Done. exit_code={exit_code} sent_n={sent_n} sent_jdk={sent_jdk}", file=sys.stderr, flush=True)
        return exit_code

if __name__ == "__main__":
    # Run update first (generates project from manifest)
    update_result = run_command(["@bubblewrap/cli", "update", "--appVersionName=1.0.0"], send_jdk=True)
    print(f"\n=== UPDATE RESULT: {update_result} ===", flush=True)
    
    if update_result == 0:
        # Run build
        build_result = run_command(["@bubblewrap/cli", "build"], send_jdk=False)
        print(f"\n=== BUILD RESULT: {build_result} ===", flush=True)
        sys.exit(build_result)
    else:
        print("\n=== UPDATE FAILED, NOT RUNNING BUILD ===", flush=True)
        sys.exit(update_result)
