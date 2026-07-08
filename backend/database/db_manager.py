import os
import sqlite3
import json
from datetime import datetime
from typing import List, Dict, Optional

DB_PATH = os.path.join(os.path.dirname(__file__), "routes.db")

class DBManager:
    @staticmethod
    def init_db():
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS saved_routes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                algorithm TEXT NOT NULL,
                name TEXT,
                created_at DATETIME NOT NULL,
                nodes_json TEXT NOT NULL,
                paths_json TEXT NOT NULL
            )
        """)
        # Migrations: add columns if they don't exist yet
        for col, typedef in [("created_at", "DATETIME"), ("name", "TEXT")]:
            try:
                cursor.execute(f"ALTER TABLE saved_routes ADD COLUMN {col} {typedef}")
            except Exception:
                pass
        conn.commit()
        conn.close()

    @staticmethod
    def save_route(algorithm: str, nodes: List[Dict], paths: list, name: Optional[str] = None):
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            now = datetime.now().isoformat()
            cursor.execute(
                "INSERT INTO saved_routes (algorithm, name, created_at, nodes_json, paths_json) VALUES (?, ?, ?, ?, ?)",
                (algorithm, name, now, json.dumps(nodes), json.dumps(paths))
            )
            route_id = cursor.lastrowid
            conn.commit()
            conn.close()
            return route_id
        except Exception as e:
            print(f"Failed to save route to DB: {e}")
            return None

    @staticmethod
    def get_history():
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, algorithm, name, created_at,
                   json_array_length(nodes_json) AS node_count
            FROM saved_routes ORDER BY created_at DESC LIMIT 100
        """)
        rows = cursor.fetchall()
        conn.close()
        return [
            {
                "id":         row[0],
                "algorithm":  row[1],
                "name":       row[2],
                "created_at": row[3],
                "node_count": row[4],
            }
            for row in rows
        ]

    @staticmethod
    def get_history_detail(route_id: int):
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT algorithm, name, created_at, nodes_json, paths_json FROM saved_routes WHERE id = ?",
            (route_id,)
        )
        row = cursor.fetchone()
        conn.close()
        if not row:
            return None
        return {
            "algorithm":  row[0],
            "name":       row[1],
            "created_at": row[2],
            "nodes":      json.loads(row[3]),
            "paths":      json.loads(row[4]),
        }

    @staticmethod
    def delete_route(route_id: int) -> bool:
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute("DELETE FROM saved_routes WHERE id = ?", (route_id,))
            deleted = cursor.rowcount > 0
            conn.commit()
            conn.close()
            return deleted
        except Exception as e:
            print(f"Failed to delete route {route_id}: {e}")
            return False

    @staticmethod
    def rename_route(route_id: int, name: str) -> bool:
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute("UPDATE saved_routes SET name = ? WHERE id = ?", (name, route_id))
            updated = cursor.rowcount > 0
            conn.commit()
            conn.close()
            return updated
        except Exception as e:
            print(f"Failed to rename route {route_id}: {e}")
            return False

    @staticmethod
    def get_stats():
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM saved_routes")
        total = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM saved_routes WHERE algorithm = 'astar'")
        astar_count = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM saved_routes WHERE algorithm = 'kruskal'")
        kruskal_count = cursor.fetchone()[0]
        conn.close()
        return {
            "total_routes":   total,
            "astar_routes":   astar_count,
            "kruskal_routes": kruskal_count,
        }
