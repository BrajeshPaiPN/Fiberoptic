// Kruskal's MST — Priority Queue A* (O(n log n) per pair), C++11 compatible
// Uses accurate terrain-cost A* for edge weights, path-compression Union-Find
#include <iostream>
#include <vector>
#include <cmath>
#include <queue>
#include <unordered_map>
#include <algorithm>
#include <limits>

using namespace std;

struct Node { int x, y; };

struct PQNode {
    double f;
    int x, y;
    bool operator>(const PQNode& o) const { return f > o.f; }
};

static const int DX[8]     = {0, 1, 0, -1,  1,  1, -1, -1};
static const int DY[8]     = {1, 0, -1, 0,  1, -1,  1, -1};
static const double BASE[8] = {1.0,1.0,1.0,1.0, 1.4142,1.4142,1.4142,1.4142};

inline double heuristic(int x1,int y1,int x2,int y2) {
    int dx=x1-x2, dy=y1-y2;
    return sqrt((double)(dx*dx+dy*dy));
}

vector<Node> reconstructPath(const unordered_map<int,int>& came, int cur, int res) {
    vector<Node> path;
    while (came.count(cur)) {
        path.push_back({ cur%res, cur/res });
        cur = came.at(cur);
    }
    path.push_back({ cur%res, cur/res });
    reverse(path.begin(), path.end());
    return path;
}

// Returns {path, g_cost}. path is empty if unreachable.
pair<vector<Node>, double> findPath(const vector<vector<float> >& grid, int res, Node start, Node end) {
    int N    = res*res;
    int sIdx = start.y*res + start.x;
    int eIdx = end.y  *res + end.x;

    vector<double>  gScore(N, numeric_limits<double>::infinity());
    vector<bool>    closed(N, false);
    unordered_map<int,int> came;

    priority_queue<PQNode, vector<PQNode>, greater<PQNode> > pq;
    gScore[sIdx] = 0.0;
    PQNode s; s.f = heuristic(start.x,start.y,end.x,end.y); s.x=start.x; s.y=start.y;
    pq.push(s);

    while (!pq.empty()) {
        PQNode top = pq.top(); pq.pop();
        int cx = top.x, cy = top.y;
        int curIdx = cy*res + cx;

        if (closed[curIdx]) continue;
        closed[curIdx] = true;

        if (curIdx == eIdx)
            return make_pair(reconstructPath(came, eIdx, res), gScore[eIdx]);

        for (int i=0; i<8; i++) {
            int nx=cx+DX[i], ny=cy+DY[i];
            if (nx<0||nx>=res||ny<0||ny>=res) continue;

            float w = grid[ny][nx];
            if (w <= 0.0f) continue;

            if (DX[i]!=0 && DY[i]!=0) {
                if (grid[cy][nx]<=0.0f || grid[ny][cx]<=0.0f) continue;
            }

            int nIdx = ny*res + nx;
            if (closed[nIdx]) continue;

            double tentG = gScore[curIdx] + BASE[i]*(double)w;
            if (tentG < gScore[nIdx]) {
                came[nIdx]   = curIdx;
                gScore[nIdx] = tentG;
                PQNode nn;
                nn.f = tentG + heuristic(nx,ny,end.x,end.y);
                nn.x = nx; nn.y = ny;
                pq.push(nn);
            }
        }
    }
    return make_pair(vector<Node>(), numeric_limits<double>::infinity());
}

// Union-Find with path compression + union-by-rank
struct DisjointSet {
    vector<int> parent, rank_;
    DisjointSet(int n) : parent(n), rank_(n,0) {
        for(int i=0;i<n;i++) parent[i]=i;
    }
    int find(int i) {
        while (parent[i]!=i) { parent[i]=parent[parent[i]]; i=parent[i]; }
        return i;
    }
    bool unite(int a, int b) {
        int ra=find(a), rb=find(b);
        if (ra==rb) return false;
        if (rank_[ra]<rank_[rb]) swap(ra,rb);
        parent[rb]=ra;
        if (rank_[ra]==rank_[rb]) rank_[ra]++;
        return true;
    }
};

struct Edge {
    int u, v;
    double cost;
    vector<Node> path;
};

bool edgeLess(const Edge& a, const Edge& b) { return a.cost < b.cost; }

int main() {
    ios::sync_with_stdio(false);
    cin.tie(NULL);

    int resolution;
    if (!(cin >> resolution)) return 0;

    int numNodes;
    cin >> numNodes;
    vector<Node> nodes(numNodes);
    for (int i=0;i<numNodes;i++) cin >> nodes[i].x >> nodes[i].y;

    vector<vector<float> > grid(resolution, vector<float>(resolution));
    for (int y=0;y<resolution;y++)
        for (int x=0;x<resolution;x++)
            cin >> grid[y][x];

    // Build complete graph using A* terrain-cost paths
    vector<Edge> edges;
    edges.reserve(numNodes*(numNodes-1)/2);

    for (int i=0;i<numNodes;i++) {
        for (int j=i+1;j<numNodes;j++) {
            pair<vector<Node>,double> result = findPath(grid, resolution, nodes[i], nodes[j]);
            vector<Node>& path = result.first;
            double cost        = result.second;
            if (!path.empty()) {
                Edge e;
                e.u    = i;
                e.v    = j;
                e.cost = cost;
                e.path = path;
                edges.push_back(e);
            }
        }
    }

    // Kruskal's MST — sort edges by terrain cost, greedily add non-cycle edges
    sort(edges.begin(), edges.end(), edgeLess);

    DisjointSet ds(numNodes);
    vector<vector<Node> > mstPaths;
    mstPaths.reserve(numNodes-1);

    for (int k=0; k<(int)edges.size(); k++) {
        if (ds.unite(edges[k].u, edges[k].v)) {
            mstPaths.push_back(edges[k].path);
            if ((int)mstPaths.size() == numNodes-1) break;  // MST complete
        }
    }

    if (mstPaths.empty()) {
        cout << "NOPATH\n";
    } else {
        cout << mstPaths.size() << "\n";
        for (int p=0; p<(int)mstPaths.size(); p++) {
            const vector<Node>& path = mstPaths[p];
            cout << path.size() << "\n";
            for (int n=0; n<(int)path.size(); n++)
                cout << path[n].x << " " << path[n].y << " ";
            cout << "\n";
        }
    }
    return 0;
}
