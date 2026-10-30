// 실행되지 않는 예제입니다. 일부러 취약하게 작성했습니다.
public class Account {
    public void close(Resource r) {
        try {
            r.close();
        } catch (Exception e) {
        }
    }

    public void load(Resource r) {
        try {
            r.load();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public boolean isAuthorized(User u) {
        try {
            return policy.check(u);
        } catch (Exception e) {
            return true;
        }
    }

    // ── 안전한 코드 ──
    public void closeSafe(Resource r) {
        try {
            r.close();
        } catch (Exception e) {
            logger.warn("close failed", e);
        }
    }

    public boolean isAuthorizedSafe(User u) {
        try {
            return policy.check(u);
        } catch (Exception e) {
            return false;
        }
    }
}
