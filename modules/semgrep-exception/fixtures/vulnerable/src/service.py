# 실행되지 않는 예제입니다. 일부러 취약하게 작성했습니다.
import logging
import traceback

log = logging.getLogger(__name__)


def cleanup(path):
    try:
        remove(path)
    except Exception:
        pass


def handle(request):
    try:
        return run(request)
    except Exception:
        return traceback.format_exc()


def check_permission(user):
    try:
        return lookup(user).allowed
    except Exception:
        return True


# ── 안전한 코드 ──
def cleanup_safe(path):
    try:
        remove(path)
    except Exception:
        log.exception("cleanup failed")


def handle_safe(request):
    try:
        return run(request)
    except Exception:
        log.error(traceback.format_exc())
        return "internal error"


def check_permission_safe(user):
    try:
        return lookup(user).allowed
    except Exception:
        return False
