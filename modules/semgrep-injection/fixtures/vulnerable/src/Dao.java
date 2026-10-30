// 실행되지 않는 예제입니다. 일부러 취약하게 작성했습니다.
import java.sql.*;

public class Dao {
    public ResultSet findUser(Connection conn, String name) throws SQLException {
        Statement st = conn.createStatement();
        return st.executeQuery("SELECT * FROM users WHERE name = '" + name + "'");
    }

    public ResultSet findUserSafe(Connection conn, String name) throws SQLException {
        PreparedStatement ps = conn.prepareStatement("SELECT * FROM users WHERE name = ?");
        ps.setString(1, name);
        return ps.executeQuery();
    }
}
