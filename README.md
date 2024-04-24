## Interactive Shell without Python, socat

After `nc -lvnp 4231`: we got a shell 
Up non interactive shell to interactive shell (no python, no socat running on machine)

/usr/bin/script -qc /bin/bash /dev/null
Ctr-Z
stty raw -echo; fg; reset
