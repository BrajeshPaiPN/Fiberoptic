# FiberPath Pro — Optical Network Planner

FiberPath Pro is a web-based geographic information system (GIS) and routing engine designed to help telecom engineers plan and optimize fiber optic network deployments. 

Instead of drawing simple straight lines between points, FiberPath Pro integrates directly with **OpenStreetMap (OSM)** to fetch real-world buildings, roads, and water bodies. It then uses advanced Graph Theory algorithms—specifically **A* Search** and **Kruskal's Minimum Spanning Tree (MST)**—to route cables around physical obstacles and along preferred pathways like municipal roads.

## ✨ Key Features
- **Real-World Obstacle Avoidance:** Fetches OSM geometry (buildings, water, roads) and converts them into a weighted terrain grid.
- **Two Routing Algorithms:** 
  - **A* Point-to-Point (Hub & Spoke):** Finds the optimal, shortest path from a central ISP to individual clients.
  - **Kruskal's MST (Daisy Chain):** Calculates the absolute lowest-cost network topology to connect all points, minimizing total fiber length (CapEx).
- **Bill of Materials (BOM) Generation:** Automatically calculates total distance, optical loss, splice points, and estimated financial costs.
- **A/B Comparison Mode:** Visually and financially compare the Hub & Spoke vs. MST topologies side-by-side.
- **Backend OSM Proxy:** Bypasses browser CORS restrictions by routing OpenStreetMap API queries securely through the Python backend.

---

## 🏗️ System Architecture

The project is built using a modern 3-tier architecture:

1. **Frontend (UI & Map Integration)**
   - Built with Vanilla JavaScript, HTML5, and CSS3.
   - Uses **Leaflet.js** for interactive map rendering.
   - Handles the rasterization of vector polygons into a 100x100 floating-point grid.
2. **Backend (API & Database)**
   - Built with **Python** and **FastAPI**.
   - Handles the OSM proxy requests.
   - Uses **SQLite** to save network history, coordinates, and BOM reports.
3. **Core Engine (Pathfinding Algorithms)**
   - High-performance algorithms written in **C++** (`astar.cpp` and `kruskal.cpp`).
   - The Python backend passes the grid weights and node coordinates to the compiled C++ executables via standard input/output (`subprocess`).

---

## 🧠 Graph Theory Concepts Used

The routing engine relies heavily on discrete mathematics and graph theory:

- **Nodes (Vertices):** The physical markers you drop on the map (ISP Datacenters, Splitter Hubs, Client Buildings).
- **Edges (Links):** The physical fiber optic cables connecting two nodes.
- **Weights (Costs):** The mathematical cost of digging a trench through a specific area. 
  - `0.0`: Buildings/Water (Impassable / Absolute Wall).
  - `0.05`: Building Edges (Extreme Penalty).
  - `0.7`: Roads (Preferred routing / Cheaper).
  - `1.0`: Open Land (Standard baseline cost).
- **Minimum Spanning Tree (MST):** A subset of the edges of a connected, edge-weighted graph that connects all the vertices together, without any cycles, and with the minimum possible total edge weight.

> **How it works internally:** For the Kruskal algorithm, the system first runs an A* search between *every possible pair* of nodes to determine the true terrain-aware cost (edge weights). Once all pairwise edges are found, Kruskal's algorithm uses a **Disjoint Set (Union-Find)** to sort and select the cheapest edges that connect the entire network without forming loops.

---

## 🚀 Setup & Installation

### Prerequisites
- **Python 3.8+**
- **C++ Compiler** (e.g., GCC/MinGW on Windows, Clang on macOS)
- **Git**

### 1. Clone the Repository
```bash
git clone https://github.com/BrajeshPaiPN/Fiberoptic.git
cd Fiberoptic
```

### 2. Compile the C++ Algorithms
The backend requires the compiled executables of the C++ files.
```bash
# On Windows
g++ backend/algorithms/astar.cpp -o backend/algorithms/astar.exe -O3
g++ backend/algorithms/kruskal.cpp -o backend/algorithms/kruskal.exe -O3

# On Linux / macOS
g++ backend/algorithms/astar.cpp -o backend/algorithms/astar -O3
g++ backend/algorithms/kruskal.cpp -o backend/algorithms/kruskal -O3
```

### 3. Setup the Python Backend
It is recommended to use a virtual environment.
```bash
# Create and activate virtual environment (Windows)
python -m venv venv
venv\Scripts\activate

# Install dependencies
pip install -r backend/requirements.txt
```

### 4. Run the Application
```bash
cd backend
uvicorn main:app --port 8000 --host 0.0.0.0
```
Open your browser and navigate to `http://localhost:8000`.

---

## 📖 Usage Instructions

1. **Load the Map:** Pan and zoom to your target neighborhood.
2. **Fetch Obstacles:** Open the left panel and click `Fetch Obstacles from OSM`. You will see red buildings and blue water bodies appear.
3. **Place Nodes:** Select `ISP Main Node`, `Splitter Hub`, or `Client Node` from the panel, then click on the map to place them. (Place them on open spaces/roads, not inside buildings).
4. **Calculate:** Scroll down and choose either the `A* Point-to-Point` or `Kruskal's MST` algorithm, then click **Calculate Route**.
5. **Analyze:** Review the Bill of Materials (BOM) popup to see the estimated costs, fiber length, and optical loss.
