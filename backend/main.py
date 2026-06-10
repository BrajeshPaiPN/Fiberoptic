import os
import subprocess
import sqlite3
import json
from datetime import datetime
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional

app = FastAPI()

DB_PATH = os.path.join(os.path.dirname(__file__), "routes.db")

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

@app.on_event("startup")
def startup_event():
    init_db()

class Node(BaseModel):
    id: int
    x: int
    y: int
    lat: float
    lng: float
    type: str

class RouteRequest(BaseModel):
    resolution: int
    grid: List[List[bool]]
    nodes: List[Node]
    algorithm: str

def save_route_to_db(algorithm: str, nodes: List[Node], paths: list):
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        nodes_dict = [n.dict() for n in nodes]
        
        cursor.execute(
            "INSERT INTO saved_routes (algorithm, timestamp, nodes_json, paths_json) VALUES (?, ?, ?, ?)",
            (algorithm, datetime.now().isoformat(), json.dumps(nodes_dict), json.dumps(paths))
        )
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Failed to save route to DB: {e}")

@app.post("/api/calculate-route")
def calculate_route(req: RouteRequest):
    if req.algorithm == "astar":
        if len(req.nodes) != 2:
            raise HTTPException(status_code=400, detail="A* requires exactly 2 nodes")
        result = run_astar(req.grid, req.resolution, req.nodes[0], req.nodes[1])
    elif req.algorithm == "kruskal":
        if len(req.nodes) < 2:
            raise HTTPException(status_code=400, detail="Kruskal requires at least 2 nodes")
        result = run_kruskal(req.grid, req.resolution, req.nodes)
    else:
        raise HTTPException(status_code=400, detail="Unsupported algorithm")
        
    if result.get("status") == "success":
        save_route_to_db(req.algorithm, req.nodes, result.get("paths"))
        
    return result

@app.get("/api/history")
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
    return {"status": "success", "history": history}

@app.get("/api/history/{route_id}")
def get_history_detail(route_id: int):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT algorithm, timestamp, nodes_json, paths_json FROM saved_routes WHERE id = ?", (route_id,))
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        raise HTTPException(status_code=404, detail="Route not found")
        
    return {
        "status": "success",
        "algorithm": row[0],
        "timestamp": row[1],
        "nodes": json.loads(row[2]),
        "paths": json.loads(row[3])
    }

def run_astar(grid, resolution, start, end):
    input_str = f"{resolution}\n{start.x} {start.y} {end.x} {end.y}\n"
    for row in grid:
        input_str += " ".join(["1" if cell else "0" for cell in row]) + "\n"
    
    executable = os.path.join(os.path.dirname(__file__), "algorithms", "astar.exe")
    if os.name != 'nt':
        executable = os.path.join(os.path.dirname(__file__), "algorithms", "astar")
        
    try:
        proc = subprocess.run([executable], input=input_str, text=True, capture_output=True, check=True)
        lines = proc.stdout.strip().split("\n")
        if not lines or lines[0] == "NOPATH":
            return {"status": "error", "message": "No path found"}
        
        path = []
        for line in lines:
            if line.strip():
                x, y = map(int, line.split())
                path.append({"x": x, "y": y})
        
        return {"status": "success", "paths": [{"path": path, "type": "backbone"}]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def run_kruskal(grid, resolution, nodes):
    input_str = f"{resolution}\n{len(nodes)}\n"
    for n in nodes:
        input_str += f"{n.x} {n.y}\n"
        
    for row in grid:
        input_str += " ".join(["1" if cell else "0" for cell in row]) + "\n"
        
    executable = os.path.join(os.path.dirname(__file__), "algorithms", "kruskal.exe")
    if os.name != 'nt':
        executable = os.path.join(os.path.dirname(__file__), "algorithms", "kruskal")
        
    try:
        proc = subprocess.run([executable], input=input_str, text=True, capture_output=True, check=True)
        lines = proc.stdout.strip().split("\n")
        if not lines or lines[0] == "NOPATH":
            return {"status": "error", "message": "No path found"}
        
        num_paths = int(lines[0])
        all_paths = []
        line_idx = 1
        for _ in range(num_paths):
            num_nodes = int(lines[line_idx])
            line_idx += 1
            coords = lines[line_idx].strip().split()
            line_idx += 1
            path = []
            for i in range(0, num_nodes * 2, 2):
                path.append({"x": int(coords[i]), "y": int(coords[i+1])})
            all_paths.append({"path": path, "type": "backbone"})
            
        return {"status": "success", "paths": all_paths}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Serve static frontend
frontend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))
app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")
