import os
import sys
import subprocess

# Ensure the backend directory is on sys.path so `database` package resolves
# regardless of whether we run from the project root or the backend folder
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

from database.db_manager import DBManager

# ── Overpass mirrors — tried in order until one succeeds ──────────────────────
OVERPASS_ENDPOINTS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
]

app = FastAPI(
    title="FiberPath Pro API",
    description="Optical fiber network planning API with A* and Kruskal's MST routing",
    version="2.0.0"
)

# ── CORS — allow frontend dev server ──────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def startup_event():
    DBManager.init_db()


# ── Pydantic models ───────────────────────────────────────────────────────────
class Node(BaseModel):
    id: int
    x: int
    y: int
    lat: float
    lng: float
    type: str
    label: Optional[str] = None

class RouteRequest(BaseModel):
    resolution: int
    grid: List[List[float]]
    nodes: List[Node]
    algorithm: str
    name: Optional[str] = None   # optional project name for saving

class RenameRequest(BaseModel):
    name: str


# ── Route calculation ─────────────────────────────────────────────────────────
@app.post("/api/calculate-route")
def calculate_route(req: RouteRequest):
    if req.algorithm == "astar":
        if len(req.nodes) < 2:
            raise HTTPException(status_code=400, detail="A* requires at least 2 nodes")
        isp_nodes   = [n for n in req.nodes if n.type == "isp"]
        other_nodes = [n for n in req.nodes if n.type != "isp"]
        start   = isp_nodes[0] if isp_nodes else req.nodes[0]
        targets = other_nodes  if other_nodes else req.nodes[1:]
        all_paths = []
        for target in targets:
            r = run_astar(req.grid, req.resolution, start, target)
            if r.get("status") == "success":
                all_paths.extend(r["paths"])
        if not all_paths:
            result = {"status": "error", "message": "No path found — try fetching obstacles or moving nodes to an open area"}
        else:
            result = {"status": "success", "paths": all_paths}

    elif req.algorithm == "kruskal":
        if len(req.nodes) < 2:
            raise HTTPException(status_code=400, detail="Kruskal requires at least 2 nodes")
        result = run_kruskal(req.grid, req.resolution, req.nodes)

    else:
        raise HTTPException(status_code=400, detail=f"Unsupported algorithm: {req.algorithm!r}")

    if result.get("status") == "success":
        nodes_dict = [n.dict() for n in req.nodes]
        route_id = DBManager.save_route(
            req.algorithm,
            nodes_dict,
            result.get("paths"),
            name=req.name,
        )
        result["route_id"] = route_id

    return result


# ── OSM proxy ─────────────────────────────────────────────────────────────────
@app.post("/api/osm-proxy-raw")
async def osm_proxy_raw(request: Request):
    body_bytes = await request.body()
    import httpx, ssl

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode    = ssl.CERT_NONE

    timeout = httpx.Timeout(35.0, connect=10.0)

    async with httpx.AsyncClient(verify=ctx, timeout=timeout) as client:
        for url in OVERPASS_ENDPOINTS:
            try:
                response = await client.post(
                    url,
                    content=body_bytes,
                    headers={
                        "Content-Type": "application/x-www-form-urlencoded",
                        "User-Agent":   "FiberPathPro/2.0",
                    }
                )
                if response.status_code == 200:
                    return JSONResponse(content=response.json())
            except Exception as e:
                print(f"[OSM Proxy] Failed for {url}: {e}")

    raise HTTPException(status_code=502, detail="All Overpass endpoints failed — check your network connection")


# ── History endpoints ─────────────────────────────────────────────────────────
@app.get("/api/history")
def get_history():
    history = DBManager.get_history()
    return {"status": "success", "history": history}

@app.get("/api/history/{route_id}")
def get_history_detail(route_id: int):
    detail = DBManager.get_history_detail(route_id)
    if not detail:
        raise HTTPException(status_code=404, detail=f"Route {route_id} not found")
    return {"status": "success", **detail}

@app.delete("/api/history/{route_id}")
def delete_history(route_id: int):
    deleted = DBManager.delete_route(route_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Route {route_id} not found")
    return {"status": "success", "deleted_id": route_id}

@app.patch("/api/history/{route_id}")
def rename_history(route_id: int, body: RenameRequest):
    updated = DBManager.rename_route(route_id, body.name.strip())
    if not updated:
        raise HTTPException(status_code=404, detail=f"Route {route_id} not found")
    return {"status": "success", "id": route_id, "name": body.name.strip()}

@app.get("/api/stats")
def get_stats():
    stats = DBManager.get_stats()
    return {"status": "success", **stats}


# ── C++ algorithm runners ─────────────────────────────────────────────────────
def _exe_path(name: str) -> str:
    base = os.path.join(os.path.dirname(__file__), "algorithms", name)
    return base + (".exe" if os.name == "nt" else "")

def run_astar(grid, resolution, start, end):
    input_str = f"{resolution}\n{start.x} {start.y} {end.x} {end.y}\n"
    for row in grid:
        input_str += " ".join(f"{cell:.4f}" for cell in row) + "\n"
    try:
        proc = subprocess.run(
            [_exe_path("astar")],
            input=input_str, text=True, capture_output=True, check=True,
            timeout=30,
        )
        lines = proc.stdout.strip().split("\n")
        if not lines or lines[0] == "NOPATH":
            return {"status": "error", "message": "No path found"}
        path = []
        for line in lines:
            if line.strip():
                x, y = map(int, line.split())
                path.append({"x": x, "y": y})
        return {"status": "success", "paths": [{"path": path, "type": "backbone"}]}
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="A* algorithm timed out (grid may be too large)")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"A* failed: {e}")

def run_kruskal(grid, resolution, nodes):
    input_str = f"{resolution}\n{len(nodes)}\n"
    for n in nodes:
        input_str += f"{n.x} {n.y}\n"
    for row in grid:
        input_str += " ".join(f"{cell:.4f}" for cell in row) + "\n"
    try:
        proc = subprocess.run(
            [_exe_path("kruskal")],
            input=input_str, text=True, capture_output=True, check=True,
            timeout=60,
        )
        lines = proc.stdout.strip().split("\n")
        if not lines or lines[0] == "NOPATH":
            return {"status": "error", "message": "No MST path found"}
        num_paths = int(lines[0])
        all_paths = []
        line_idx  = 1
        for _ in range(num_paths):
            num_nodes = int(lines[line_idx]); line_idx += 1
            coords    = lines[line_idx].strip().split(); line_idx += 1
            path = [{"x": int(coords[i]), "y": int(coords[i+1])} for i in range(0, num_nodes * 2, 2)]
            all_paths.append({"path": path, "type": "backbone"})
        return {"status": "success", "paths": all_paths}
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Kruskal algorithm timed out — reduce node count")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Kruskal failed: {e}")


# ── Serve static frontend ─────────────────────────────────────────────────────
frontend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))
app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")
