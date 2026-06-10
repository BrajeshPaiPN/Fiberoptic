#include <iostream>
#include <vector>
#include <cmath>
#include <queue>
#include <unordered_map>
#include <unordered_set>
#include <string>
#include <algorithm>
#include <limits>

using namespace std;

struct Node {
    int x, y;
};

class AStarPathfinder {
private:
    vector<vector<bool>> grid;
    int resolution;
    int dx[8] = {0, 1, 0, -1, 1, 1, -1, -1};
    int dy[8] = {1, 0, -1, 0, 1, -1, 1, -1};
    double cost[8] = {1.0, 1.0, 1.0, 1.0, 1.414, 1.414, 1.414, 1.414};

    double heuristic(int x1, int y1, int x2, int y2) {
        return hypot(x1 - x2, y1 - y2);
    }

    string nodeStr(int x, int y) {
        return to_string(x) + "," + to_string(y);
    }

    vector<Node> reconstructPath(unordered_map<string, string>& cameFrom, string currentStr) {
        vector<Node> path;
        size_t commaPos = currentStr.find(',');
        int cx = stoi(currentStr.substr(0, commaPos));
        int cy = stoi(currentStr.substr(commaPos + 1));
        path.push_back({cx, cy});

        string curr = currentStr;
        while (cameFrom.find(curr) != cameFrom.end()) {
            curr = cameFrom[curr];
            commaPos = curr.find(',');
            int px = stoi(curr.substr(0, commaPos));
            int py = stoi(curr.substr(commaPos + 1));
            path.insert(path.begin(), {px, py});
        }
        return path;
    }

public:
    AStarPathfinder(vector<vector<bool>> g, int res) : grid(g), resolution(res) {}

    vector<Node> findPath(Node start, Node end) {
        unordered_set<string> openSet;
        unordered_set<string> closedSet;

        string startStr = nodeStr(start.x, start.y);
        openSet.insert(startStr);

        unordered_map<string, double> gScore;
        gScore[startStr] = 0;

        unordered_map<string, double> fScore;
        fScore[startStr] = heuristic(start.x, start.y, end.x, end.y);

        unordered_map<string, string> cameFrom;

        while (!openSet.empty()) {
            string currentStr = "";
            double lowestF = numeric_limits<double>::infinity();

            for (const string& str : openSet) {
                double f = fScore.count(str) ? fScore[str] : numeric_limits<double>::infinity();
                if (f < lowestF) {
                    lowestF = f;
                    currentStr = str;
                }
            }

            size_t commaPos = currentStr.find(',');
            int cx = stoi(currentStr.substr(0, commaPos));
            int cy = stoi(currentStr.substr(commaPos + 1));

            if (cx == end.x && cy == end.y) {
                return reconstructPath(cameFrom, currentStr);
            }

            openSet.erase(currentStr);
            closedSet.insert(currentStr);

            for (int i = 0; i < 8; i++) {
                int nx = cx + dx[i];
                int ny = cy + dy[i];

                if (nx < 0 || nx >= resolution || ny < 0 || ny >= resolution) continue;
                if (!grid[ny][nx]) continue;

                if (dx[i] != 0 && dy[i] != 0) {
                    if (!grid[cy][nx] && !grid[ny][cx]) continue;
                }

                string neighborStr = nodeStr(nx, ny);
                if (closedSet.count(neighborStr)) continue;

                double tentativeG = (gScore.count(currentStr) ? gScore[currentStr] : numeric_limits<double>::infinity()) + cost[i];

                if (!openSet.count(neighborStr)) {
                    openSet.insert(neighborStr);
                } else if (tentativeG >= (gScore.count(neighborStr) ? gScore[neighborStr] : numeric_limits<double>::infinity())) {
                    continue;
                }

                cameFrom[neighborStr] = currentStr;
                gScore[neighborStr] = tentativeG;
                fScore[neighborStr] = tentativeG + heuristic(nx, ny, end.x, end.y);
            }
        }
        return {};
    }
};

class DisjointSet {
private:
    vector<int> parent;
public:
    DisjointSet(int size) {
        parent.resize(size);
        for (int i = 0; i < size; i++) parent[i] = i;
    }
    int find(int i) {
        if (parent[i] == i) return i;
        return parent[i] = find(parent[i]);
    }
    bool unionNodes(int i, int j) {
        int rootI = find(i);
        int rootJ = find(j);
        if (rootI != rootJ) {
            parent[rootI] = rootJ;
            return true;
        }
        return false;
    }
};

struct Edge {
    int u, v;
    double cost;
    vector<Node> path;
};

int main() {
    int resolution;
    if (!(cin >> resolution)) return 0;
    
    int numNodes;
    cin >> numNodes;
    vector<Node> nodes(numNodes);
    for (int i = 0; i < numNodes; i++) {
        cin >> nodes[i].x >> nodes[i].y;
    }

    vector<vector<bool>> grid(resolution, vector<bool>(resolution));
    for (int y = 0; y < resolution; y++) {
        for (int x = 0; x < resolution; x++) {
            int val;
            cin >> val;
            grid[y][x] = (val == 1);
        }
    }

    AStarPathfinder pf(grid, resolution);
    vector<Edge> edges;

    for (int i = 0; i < numNodes; i++) {
        for (int j = i + 1; j < numNodes; j++) {
            vector<Node> path = pf.findPath(nodes[i], nodes[j]);
            if (!path.empty()) {
                edges.push_back({i, j, (double)path.size(), path});
            }
        }
    }

    sort(edges.begin(), edges.end(), [](const Edge& a, const Edge& b) {
        return a.cost < b.cost;
    });

    DisjointSet ds(numNodes);
    vector<vector<Node>> mstPaths;

    for (const auto& edge : edges) {
        if (ds.unionNodes(edge.u, edge.v)) {
            mstPaths.push_back(edge.path);
        }
    }

    if (mstPaths.empty()) {
        cout << "NOPATH\n";
    } else {
        cout << mstPaths.size() << "\n";
        for (const auto& path : mstPaths) {
            cout << path.size() << "\n";
            for (const auto& p : path) {
                cout << p.x << " " << p.y << " ";
            }
            cout << "\n";
        }
    }

    return 0;
}
