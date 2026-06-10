import os
import subprocess
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List

from database.db_manager import DBManager

app = FastAPI()

@app.on_event("startup")
def startup_event():
    DBManager.init_db()

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
        nodes_dict = [n.dict() for n in req.nodes]
        DBManager.save_route(req.algorithm, nodes_dict, result.get("paths"))
        
    return result

@app.get("/api/history")
def get_history():
    history = DBManager.get_history()
    return {"status": "success", "history": history}

@app.get("/api/history/{route_id}")
def get_history_detail(route_id: int):
    detail = DBManager.get_history_detail(route_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Route not found")
        
    return {"status": "success", **detail}

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
