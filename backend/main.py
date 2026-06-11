import os
import subprocess
import urllib.request
import urllib.parse
from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List

from database.db_manager import DBManager

# Overpass mirrors — tried in order until one succeeds
OVERPASS_ENDPOINTS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
]

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
    grid: List[List[float]]   # float weights: 0=blocked, 1=normal, <1=road/preferred, >1=penalty
    nodes: List[Node]
    algorithm: str

@app.post("/api/calculate-route")
def calculate_route(req: RouteRequest):
    if req.algorithm == "astar":
        if len(req.nodes) < 2:
            raise HTTPException(status_code=400, detail="A* requires at least 2 nodes")
        # Find ISP node as the hub; route from it to every other node
        isp_nodes = [n for n in req.nodes if n.type == "isp"]
        other_nodes = [n for n in req.nodes if n.type != "isp"]
        start = isp_nodes[0] if isp_nodes else req.nodes[0]
        targets = other_nodes if other_nodes else req.nodes[1:]
        all_paths = []
        for target in targets:
            r = run_astar(req.grid, req.resolution, start, target)
            if r.get("status") == "success":
                all_paths.extend(r["paths"])
        if not all_paths:
            result = {"status": "error", "message": "No path found — try fetching obstacles or moving nodes to open area"}
        else:
            result = {"status": "success", "paths": all_paths}
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

@app.post("/api/osm-proxy")
async def osm_proxy(req: BaseModel):
    # Proxy request from frontend to Overpass with correct headers and SSL bypass
    # req expects a generic body, so we read raw request body
    pass

@app.post("/api/osm-proxy-raw")
async def osm_proxy_raw(request: Request):
    body_bytes = await request.body()
    import httpx
    import ssl
    
    # Bypass SSL verification and set User-Agent to avoid 406/403
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    
    timeout = httpx.Timeout(30.0)
    
    async with httpx.AsyncClient(verify=ctx, timeout=timeout) as client:
        for url in OVERPASS_ENDPOINTS:
            try:
                response = await client.post(
                    url,
                    content=body_bytes,
                    headers={
                        "Content-Type": "application/x-www-form-urlencoded",
                        "User-Agent": "FiberPathPro/1.0"
                    }
                )
                if response.status_code == 200:
                    return JSONResponse(content=response.json())
            except Exception as e:
                print(f"Proxy failed for {url}: {e}")
                
    raise HTTPException(status_code=502, detail="All Overpass endpoints failed")

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
        input_str += " ".join([f"{cell:.4f}" for cell in row]) + "\n"
    
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
        input_str += " ".join([f"{cell:.4f}" for cell in row]) + "\n"
        
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
