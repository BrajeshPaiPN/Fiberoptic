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
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS saved_routes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                algorithm TEXT NOT NULL,
                timestamp DATETIME NOT NULL,
                nodes_json TEXT NOT NULL,
                paths_json TEXT NOT NULL
            )
        """)
        conn.commit()
        conn.close()

    @staticmethod
    def save_route(algorithm: str, nodes: List[Dict], paths: list):
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            
            cursor.execute(
                "INSERT INTO saved_routes (algorithm, timestamp, nodes_json, paths_json) VALUES (?, ?, ?, ?)",
                (algorithm, datetime.now().isoformat(), json.dumps(nodes), json.dumps(paths))
            )
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"Failed to save route to DB: {e}")

    @staticmethod
    def get_history():
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT id, algorithm, timestamp FROM saved_routes ORDER BY timestamp DESC")
        rows = cursor.fetchall()
        conn.close()
        
        history = []
        for row in rows:
            history.append({
                "id": row[0],
                "algorithm": row[1],
                "timestamp": row[2]
            })
        return history

    @staticmethod
    def get_history_detail(route_id: int):
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT algorithm, timestamp, nodes_json, paths_json FROM saved_routes WHERE id = ?", (route_id,))
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            return None
            
        return {
            "algorithm": row[0],
            "timestamp": row[1],
            "nodes": json.loads(row[2]),
            "paths": json.loads(row[3])
        }
