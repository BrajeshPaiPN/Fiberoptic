// Kruskal's MST with WEIGHTED terrain grid
// Uses A* with float weights to find edge costs between all node pairs
#include <iostream>
#include <vector>
#include <cmath>
#include <unordered_map>
#include <unordered_set>
#include <string>
#include <algorithm>
#include <limits>

using namespace std;

struct Node { int x, y; };

class AStarPathfinder {
private:
    vector<vector<float>> grid;
    int resolution;
    int dx[8]      = {0, 1, 0, -1,  1,  1, -1, -1};
    int dy[8]      = {1, 0, -1, 0,  1, -1,  1, -1};
    double base[8] = {1.0, 1.0, 1.0, 1.0, 1.414, 1.414, 1.414, 1.414};

    double heuristic(int x1, int y1, int x2, int y2) {
        return hypot(x1-x2, y1-y2);
    }
    string nodeStr(int x, int y) { return to_string(x)+","+to_string(y); }

    vector<Node> reconstructPath(unordered_map<string,string>& came, string cur) {
        vector<Node> path;
        size_t c = cur.find(',');
        path.push_back({stoi(cur.substr(0,c)), stoi(cur.substr(c+1))});
        while (came.count(cur)) {
            cur = came[cur];
            c = cur.find(',');
            path.insert(path.begin(), {stoi(cur.substr(0,c)), stoi(cur.substr(c+1))});
        }
        return path;
    }

public:
    AStarPathfinder(vector<vector<float>> g, int res) : grid(g), resolution(res) {}

    vector<Node> findPath(Node start, Node end) {
        unordered_set<string> open, closed;
        unordered_map<string,double> g_score, f_score;
        unordered_map<string,string> came;

        string startStr = nodeStr(start.x, start.y);
        open.insert(startStr);
        g_score[startStr] = 0;
        f_score[startStr] = heuristic(start.x, start.y, end.x, end.y);

        while (!open.empty()) {
            string cur = "";
            double lowestF = numeric_limits<double>::infinity();
            for (const string& s : open) {
                double f = f_score.count(s) ? f_score[s] : numeric_limits<double>::infinity();
                if (f < lowestF) { lowestF = f; cur = s; }
            }

            size_t c = cur.find(',');
            int cx = stoi(cur.substr(0,c)), cy = stoi(cur.substr(c+1));

            if (cx == end.x && cy == end.y)
                return reconstructPath(came, cur);

            open.erase(cur);
            closed.insert(cur);

            for (int i = 0; i < 8; i++) {
                int nx = cx+dx[i], ny = cy+dy[i];
                if (nx<0||nx>=resolution||ny<0||ny>=resolution) continue;

                float cellWeight = grid[ny][nx];
                if (cellWeight <= 0.0f) continue;

                if (dx[i]!=0 && dy[i]!=0) {
                    if (grid[cy][nx]<=0.0f && grid[ny][cx]<=0.0f) continue;
                }

                string nStr = nodeStr(nx, ny);
                if (closed.count(nStr)) continue;

                double moveCost = base[i] * cellWeight;
                double tentG = (g_score.count(cur) ? g_score[cur] : numeric_limits<double>::infinity()) + moveCost;

                if (!open.count(nStr)) {
                    open.insert(nStr);
                } else if (tentG >= (g_score.count(nStr) ? g_score[nStr] : numeric_limits<double>::infinity())) {
                    continue;
                }

                came[nStr] = cur;
                g_score[nStr] = tentG;
                f_score[nStr] = tentG + heuristic(nx, ny, end.x, end.y);
            }
        }
        return {};
    }
};

class DisjointSet {
    vector<int> parent;
public:
    DisjointSet(int n) { parent.resize(n); for(int i=0;i<n;i++) parent[i]=i; }
    int find(int i) { return parent[i]==i ? i : parent[i]=find(parent[i]); }
    bool unite(int i, int j) {
        int ri=find(i), rj=find(j);
        if(ri!=rj){ parent[ri]=rj; return true; }
        return false;
    }
};

struct Edge { int u, v; double cost; vector<Node> path; };

int main() {
    int resolution;
    if (!(cin >> resolution)) return 0;

    int numNodes;
    cin >> numNodes;
    vector<Node> nodes(numNodes);
    for (int i=0;i<numNodes;i++) cin >> nodes[i].x >> nodes[i].y;

    vector<vector<float>> grid(resolution, vector<float>(resolution));
    for (int y=0;y<resolution;y++)
        for (int x=0;x<resolution;x++)
            cin >> grid[y][x];

    AStarPathfinder pf(grid, resolution);
    vector<Edge> edges;

    for (int i=0;i<numNodes;i++) {
        for (int j=i+1;j<numNodes;j++) {
            vector<Node> path = pf.findPath(nodes[i], nodes[j]);
            if (!path.empty())
                edges.push_back({i, j, (double)path.size(), path});
        }
    }

    sort(edges.begin(), edges.end(), [](const Edge& a, const Edge& b){ return a.cost<b.cost; });

    DisjointSet ds(numNodes);
    vector<vector<Node>> mstPaths;
    for (const auto& e : edges)
        if (ds.unite(e.u, e.v))
            mstPaths.push_back(e.path);

    if (mstPaths.empty()) {
        cout << "NOPATH\n";
    } else {
        cout << mstPaths.size() << "\n";
        for (const auto& path : mstPaths) {
            cout << path.size() << "\n";
            for (const auto& p : path)
                cout << p.x << " " << p.y << " ";
            cout << "\n";
        }
    }
    return 0;
}
