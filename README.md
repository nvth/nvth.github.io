## Kali
### Auto login with root user in kali
After "researching" for half a day here is how to auto login in 2020.1 version

nano /etc/lightdm/lightdm.conf # and add these lines in [Seat:*] section

autologin-user=root
autologin-user-timeout=o

nano /etc/pam.d/lightdm-autologin #Comment out below line
#auth required pam_succeed_if.so user != root quiet_success

restart and hapy root
## Trick
### Interactive Shell without Python, socat

After `nc -lvnp 4231`: we got a shell 
Up non interactive shell to interactive shell (no python, no socat running on machine)

/usr/bin/script -qc /bin/bash /dev/null
Ctr-Z
stty raw -echo; fg; reset
