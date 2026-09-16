## Why add an alias layer to Command Prompt?

Command Prompt is still useful on Windows, but switching between `dir` and `ls`, `type` and `cat`, or Windows and Linux deletion syntax creates needless friction. The `cmd-aliases-main` project adds a thin compatibility layer: it keeps `cmd.exe`, registers familiar commands, and generates wrappers for commands that need argument handling.

The goal is not to turn Command Prompt into Linux. It is to make a Windows terminal feel more predictable for people who already work in Linux-style workflows, without installing another shell.

## What does the project install?

The setup script creates two layers:

| Component | Role |
| --- | --- |
| `C:\alias\cmd.cmd` | AutoRun file that registers aliases in new Command Prompt windows |
| `%USERPROFILE%\.cmd-aliases\bin` | Wrappers for the current user |
| `C:\ProgramData\cmd-aliases\bin` | Wrappers for an all-users installation |
| Registry AutoRun | Loads the aliases whenever a new Command Prompt starts |

Simple aliases call Windows commands directly. For example, `ls` maps to `dir /b`, `pwd` maps to `cd`, and `cat` maps to `type`. Commands such as `rm`, `cp`, `mkdir`, `rmdir`, and `find` are generated as separate `.cmd` wrappers so they can process options and paths.

## Install for the current user

This is the right starting point for a trial. Download [setup-aliases-full.cmd](/bdata/setup-aliases-full.cmd) and double-click it; the script installs into the current profile and does not require Administrator privileges.

After the script reports success, close and reopen Command Prompt. Try:

```cmd
ls
pwd
cat README.md
find . -name *.md
```

Aliases are loaded in new `cmd.exe` windows. A window that was already open will not automatically pick up the AutoRun change.

## Install for all users

Open Command Prompt as Administrator and run:

```cmd
setup-aliases-full.cmd /all
```

The script uses `C:\ProgramData\cmd-aliases` and writes AutoRun to:

```text
HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Command Processor
```

The script also accepts `/system` and `/machine` as aliases for `/all`. Without administrative privileges, the all-users mode stops before making the installation.

## Quick command map

| Linux-style command | Windows command or wrapper | Notes |
| --- | --- | --- |
| `ls`, `ll`, `la` | `dir /b`, `dir`, `dir /a` | List files and directories |
| `pwd` | `cd` | Print the current directory |
| `cat` | `type` | Read a file |
| `less` | `more` | Read a file page by page |
| `grep`, `grepr` | `findstr` | Search text; `grepr` searches recursively |
| `ps`, `top` | `tasklist`, `tasklist /v` | Inspect processes |
| `kill` | `taskkill /PID ... /F` | Stop a process by PID |
| `ss` | `netstat -ano` | Inspect sockets and PIDs |
| `ip`, `ifconfig` | `ipconfig` | Inspect network configuration |
| `cp`, `mv` | `cp.cmd`, `move` | Copy or move files |
| `rm`, `mkdir`, `rmdir`, `find` | `.cmd` wrappers | Provide familiar options |

## What to remember about the wrappers

These wrappers are not a complete implementation of GNU coreutils. They focus on common Command Prompt workflows.

For `rm`, `-r` enables recursive directory removal and `-f` forces file removal. Passing a directory without `-r` is rejected. Inspect a path before deleting it:

```cmd
dir target
rm -rf target
```

`cp` requires `-r`, `-R`, or `-a` when the source is a directory. `mkdir` and `rmdir` accept `-p` for Linux-style compatibility, while `find` supports the basic `-name` pattern.

## Uninstall

Download and run [uninstall-aliases.cmd](/bdata/uninstall-aliases.cmd):

```cmd
uninstall-aliases.cmd
```

The script removes AutoRun and the alias files it created. Open a fresh Command Prompt afterwards so the old configuration is no longer loaded.

## Extend the aliases

The central file is `C:\alias\cmd.cmd`. Add a `doskey` line such as:

```cmd
doskey c=cls
doskey croot=cd /d C:\workspace
```

Only newly opened `cmd.exe` windows will load the edited file. Keep aliases short and avoid names that could shadow important programs on `PATH`.

## Closing note

`cmd-aliases-main` is small but practical: it is quick to install, leaves the default shell intact, and brings common terminal conventions to Windows. The important part is understanding what each wrapper does—especially destructive operations—before using it in a daily environment.
