// A* Pathfinder with WEIGHTED terrain grid
// Grid values: 0 = impassable, > 0 = cost multiplier (1.0 = normal, >1 = expensive)
#include <iostream>
#include <vector>
#include <cmath>
#include <queue>
#include <unordered_map>
#include <unordered_set>
#include <string>
#include <limits>

using namespace std;

struct Node { int x, y; };

class AStarPathfinder {
private:
    vector<vector<float>> grid;  // float weight grid (0=blocked, 1=normal, 0.7=road preferred)
    int resolution;
    int dx[8]     = {0, 1, 0, -1,  1,  1, -1, -1};
    int dy[8]     = {1, 0, -1, 0,  1, -1,  1, -1};
    double base[8]= {1.0, 1.0, 1.0, 1.0, 1.414, 1.414, 1.414, 1.414};

    double heuristic(int x1, int y1, int x2, int y2) {
        return hypot(x1 - x2, y1 - y2);
    }

    string nodeStr(int x, int y) {
        return to_string(x) + "," + to_string(y);
    }

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
            // Find lowest f in open set
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
                int nx = cx + dx[i], ny = cy + dy[i];
                if (nx < 0 || nx >= resolution || ny < 0 || ny >= resolution) continue;

                float cellWeight = grid[ny][nx];
                if (cellWeight <= 0.0f) continue;  // impassable (building, water)

                // Prevent corner-cutting through diagonally-adjacent obstacles
                if (dx[i] != 0 && dy[i] != 0) {
                    if (grid[cy][nx] <= 0.0f && grid[ny][cx] <= 0.0f) continue;
                }

                string nStr = nodeStr(nx, ny);
                if (closed.count(nStr)) continue;

                // Terrain cost = base movement cost * (1 / cellWeight)
                // Low cellWeight = high cost (roads are 0.7 so cost = 1/0.7 ≈ 1.43 → preferred over open land)
                // We invert: road at 1.5 means PREFERRED (lower cost), building_edge at 8.0 means PENALTY
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

int main() {
    int resolution;
    if (!(cin >> resolution)) return 0;

    Node start, end;
    cin >> start.x >> start.y >> end.x >> end.y;

    vector<vector<float>> grid(resolution, vector<float>(resolution));
    for (int y = 0; y < resolution; y++)
        for (int x = 0; x < resolution; x++)
            cin >> grid[y][x];

    AStarPathfinder pf(grid, resolution);
    vector<Node> path = pf.findPath(start, end);

    if (path.empty()) {
        cout << "NOPATH\n";
    } else {
        for (const auto& p : path)
            cout << p.x << " " << p.y << "\n";
    }
    return 0;
}
