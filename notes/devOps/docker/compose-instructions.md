# Docker Compose Instructions Reference

## Instructions

| Instruction   | Description                                                                             |
| ------------- | --------------------------------------------------------------------------------------- |
| `version`     | Specifies the version of the Docker Compose file format.                                  |
| `services`    | Defines the services that make up your application.                                      |
| `image`       | Specifies the Docker image to use for a service.                                         |
| `build`       | Specifies the build context and Dockerfile for a service. Used for custom image builds.   |
| `ports`       | Exposes and optionally maps ports between the host and container.                       |
| `volumes`     | Mounts volumes from the host or other containers into the service.                      |
| `networks`    | Defines custom networks to connect services.                                             |
| `environment` | Sets environment variables for the service.                                             |
| `depends_on`  | Specifies dependencies between services. Ensures proper startup order.                   |
| `restart`     | Controls the restart policy for the service.                                            |
| `command`     | Overrides the default command specified by the image.                                    |
| `entrypoint`  | Overrides the default entry point of the container.                                     |
| `healthcheck` | Defines a health check for the service. Allows checking if the container is healthy.     |


### version

Specifies the version of the Docker Compose file format.

```yaml
version: '3'
```

### services

Defines the services that make up your application.

```yaml
services:
  web:
    image: nginx
  database:
    image: postgres
```

### image

Specifies the Docker image to use for a service.

```yaml
services:
  web:
    image: nginx
```

### build

Specifies the build context and Dockerfile for a service. Used for custom image builds.

```yaml
services:
  app:
    build:
      context: ./myapp
      dockerfile: Dockerfile.prod
```

### ports

Exposes and optionally maps ports between the host and container.

```yaml
services:
  web:
    ports:
      - "8080:80"
```

### volumes

Mounts volumes from the host or other containers into the service.

```yaml
services:
  app:
    volumes:
      - /path/on/host:/path/in/container
```

### networks

Defines custom networks to connect services.

```yaml
services:
  frontend:
    networks:
      - frontend
  backend:
    networks:
      - backend
networks:
  frontend:
  backend:
```

### environment

Sets environment variables for the service.

```yaml
services:
  app:
    environment:
      - NODE_ENV=production
      - DEBUG=myapp:*
```

### depends_on

Specifies dependencies between services. Ensures proper startup order.

```yaml
services:
  web:
    depends_on:
      - database
```

### restart

Controls the restart policy for the service.

```yaml
services:
  app:
    restart: always
```

### command

Overrides the default command specified by the image.

```yaml
services:
  app:
    command: ["bundle", "exec", "thin", "-p", "3000"]
```

### entrypoint

Overrides the default entry point of the container.

```yaml
services:
  app:
    entrypoint: /app/entry.sh
```

### healthcheck

Defines a health check for the service. Allows checking if the container is healthy.

```yaml
services:
  web:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost"]
      interval: 30s
      timeout: 10s
      retries: 3
```
