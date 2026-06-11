import os
import sqlite3
import json
from datetime import datetime
from typing import List, Dict

DB_PATH = os.path.join(os.path.dirname(__file__), "routes.db")

class DBManager:
    @staticmethod
    def init_db():
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        # Use created_at for consistency with frontend expectations
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS saved_routes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                algorithm TEXT NOT NULL,
                created_at DATETIME NOT NULL,
                nodes_json TEXT NOT NULL,
                paths_json TEXT NOT NULL
            )
        """)
        # Migration: add created_at column if old schema has timestamp column
        try:
            cursor.execute("ALTER TABLE saved_routes ADD COLUMN created_at DATETIME")
        except Exception:
            pass  # column already exists
        conn.commit()
        conn.close()

    @staticmethod
    def save_route(algorithm: str, nodes: List[Dict], paths: list):
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            now = datetime.now().isoformat()
            # Try new schema first
            try:
                cursor.execute(
                    "INSERT INTO saved_routes (algorithm, created_at, nodes_json, paths_json) VALUES (?, ?, ?, ?)",
                    (algorithm, now, json.dumps(nodes), json.dumps(paths))
                )
            except Exception:
                # Fallback if schema has timestamp column
                cursor.execute(
                    "INSERT INTO saved_routes (algorithm, timestamp, nodes_json, paths_json) VALUES (?, ?, ?, ?)",
                    (algorithm, now, json.dumps(nodes), json.dumps(paths))
                )
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"Failed to save route to DB: {e}")

    @staticmethod
    def get_history():
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        # Support both created_at and timestamp column names
        try:
            cursor.execute("""
                SELECT id, algorithm, created_at,
                       json_array_length(nodes_json) AS node_count
                FROM saved_routes ORDER BY created_at DESC LIMIT 50
            """)
        except Exception:
            cursor.execute("""
                SELECT id, algorithm, timestamp AS created_at,
                       json_array_length(nodes_json) AS node_count
                FROM saved_routes ORDER BY timestamp DESC LIMIT 50
            """)
        rows = cursor.fetchall()
        conn.close()

        return [
            {
                "id": row[0],
                "algorithm": row[1],
                "created_at": row[2],
                "node_count": row[3]
            }
            for row in rows
        ]

    @staticmethod
    def get_history_detail(route_id: int):
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        try:
            cursor.execute(
                "SELECT algorithm, created_at, nodes_json, paths_json FROM saved_routes WHERE id = ?",
                (route_id,)
            )
        except Exception:
            cursor.execute(
                "SELECT algorithm, timestamp, nodes_json, paths_json FROM saved_routes WHERE id = ?",
                (route_id,)
            )
        row = cursor.fetchone()
        conn.close()

        if not row:
            return None

        return {
            "algorithm": row[0],
            "created_at": row[1],
            "nodes": json.loads(row[2]),
            "paths": json.loads(row[3])
        }
