// A* Pathfinder — Priority Queue (O(n log n)), C++11 compatible, weighted terrain grid
// Grid values: 0.0=impassable, 0.7=road(preferred), 1.0=open, 5.0=building edge(costly)
#include <iostream>
#include <vector>
#include <cmath>
#include <queue>
#include <unordered_map>
#include <string>
#include <limits>
#include <algorithm>

using namespace std;

struct Node { int x, y; };

struct PQNode {
    double f;
    int x, y;
    bool operator>(const PQNode& o) const { return f > o.f; }
};

static const int DX[8]    = {0, 1, 0, -1,  1,  1, -1, -1};
static const int DY[8]    = {1, 0, -1, 0,  1, -1,  1, -1};
static const double BASE[8]= {1.0,1.0,1.0,1.0, 1.4142,1.4142,1.4142,1.4142};

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

vector<Node> findPath(const vector<vector<float> >& grid, int res, Node start, Node end) {
    int N    = res * res;
    int sIdx = start.y*res + start.x;
    int eIdx = end.y  *res + end.x;

    vector<double> gScore(N, numeric_limits<double>::infinity());
    vector<bool>   closed(N, false);
    unordered_map<int,int> came;

    priority_queue<PQNode, vector<PQNode>, greater<PQNode> > pq;
    gScore[sIdx] = 0.0;
    PQNode s; s.f = heuristic(start.x,start.y,end.x,end.y); s.x=start.x; s.y=start.y;
    pq.push(s);

    while (!pq.empty()) {
        PQNode top = pq.top(); pq.pop();
        int cx = top.x, cy = top.y;
        int curIdx = cy*res + cx;

        if (closed[curIdx]) continue;  // lazy deletion
        closed[curIdx] = true;

        if (curIdx == eIdx)
            return reconstructPath(came, eIdx, res);

        for (int i = 0; i < 8; i++) {
            int nx = cx+DX[i], ny = cy+DY[i];
            if (nx<0||nx>=res||ny<0||ny>=res) continue;

            float w = grid[ny][nx];
            if (w <= 0.0f) continue;  // blocked

            // Strict corner-cutting prevention: forbid diagonal if EITHER orthogonal neighbor blocked
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
    return vector<Node>();  // no path
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(NULL);

    int resolution;
    if (!(cin >> resolution)) return 0;

    Node start, end;
    cin >> start.x >> start.y >> end.x >> end.y;

    vector<vector<float> > grid(resolution, vector<float>(resolution));
    for (int y=0; y<resolution; y++)
        for (int x=0; x<resolution; x++)
            cin >> grid[y][x];

    vector<Node> path = findPath(grid, resolution, start, end);

    if (path.empty()) {
        cout << "NOPATH\n";
    } else {
        for (size_t i=0; i<path.size(); i++)
            cout << path[i].x << " " << path[i].y << "\n";
    }
    return 0;
}
