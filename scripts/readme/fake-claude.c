// A process named `claude` that only sleeps, so the live-session check (`ps -o comm=`) sees livesim.mjs's session as running.
#include <unistd.h>
int main(){sleep(3600);return 0;}
