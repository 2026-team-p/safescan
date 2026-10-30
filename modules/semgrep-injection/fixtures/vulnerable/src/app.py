# 실행되지 않는 예제입니다. 일부러 취약하게 작성했습니다.
import os
import subprocess
from flask import Flask, request, render_template_string

app = Flask(__name__)


def find_user(cursor):
    uid = request.args.get("id")
    cursor.execute(f"SELECT * FROM users WHERE id = {uid}")


def backup():
    name = request.args.get("name")
    os.system("tar czf /tmp/" + name)


def greet():
    return render_template_string("<h1>Hello " + request.args.get("n") + "</h1>")


# ── 안전한 코드 ──
def find_user_safe(cursor):
    cursor.execute("SELECT * FROM users WHERE id = %s", (request.args.get("id"),))


def list_dir():
    subprocess.run(["ls", "-l"])
