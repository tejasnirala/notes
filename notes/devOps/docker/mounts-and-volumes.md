# Mount & Volumes

In Docker, mounting refers to the process of attaching a file or directory from the host machine to a specific location within a running Docker container. This allows the container to access and manipulate the files on the host system.

There are two main types of mounts in Docker:

## Volume Mounts

* A volume is a specially designated directory managed by Docker that exists outside of the container's filesystem.
* Volumes are intended to persist data even if the container is removed.
* They are often used for sharing data between containers or for persisting data beyond the lifecycle of a single container.
* Example: `docker run -v /host/path:/container/path myimage`

## Bind Mounts

* A bind mount links a specific file or directory on the host machine directly to a directory in the container.
* Changes made in the container are reflected on the host, and vice versa.
* Bind mounts are suitable for development and debugging scenarios, as they provide direct access to the host's filesystem.
* Example: `docker run -v .:/container/path myimage` OR  `docker run -v $(pwd):/container/path myimage`

The general syntax for both volume and bind mounts is `-v` or `--volume` in the `docker run` command.