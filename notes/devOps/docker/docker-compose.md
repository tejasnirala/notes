# Docker Compose

Docker Compose is a tool for defining and running multi-container Docker applications. It allows you to define a multi-container environment in a single file (usually named **`docker-compose.yml`** ), making it easier to manage complex applications that require multiple services.

Here are some key concepts and features of Docker Compose:

## Services

  A service in Docker Compose refers to a containerised application component. For example, a web server, a database, or any other component that runs as a container.

## `docker-compose.yml`

  This is the configuration file where you define your services, networks, and volumes. It follows a YAML syntax and contains information about the services, their configurations, dependencies, and how they should interact.

## Containers and Images

  Docker Compose uses Docker images as the basis for creating containers. You can specify the base image for each service in the **`docker-compose.yml`** file.

## Networking

  Docker Compose automatically creates a default network for your services, allowing them to communicate with each other. You can also define custom networks to control communication between services.

## Volumes

  Volumes allow you to persist data between container restarts. You can define volumes in the **`docker-compose.yml`** file to ensure that data is not lost when containers are stopped or removed.

## Environment Variables

  Docker Compose allows you to set environment variables for your services, making it easy to configure your application. This is often used for specifying connection strings, API keys, or other configuration parameters.

## Scaling

  You can specify the number of replicas for each service, allowing you to scale your application horizontally. For example, you can run multiple instances of a web server or a database.

## Building Images

  Docker Compose can build custom Docker images using the instructions provided in your Dockerfile. This is useful when you need to customize the environment for your services.

## Command-Line Interface (CLI)

  Docker Compose provides a set of CLI commands for managing your multi-container application, such as **`docker-compose up`** to start the services, **`docker-compose down`** to stop them, and **`docker-compose ps`** to list the running services.


Using Docker Compose simplifies the process of managing complex applications by defining their structure, dependencies, and configurations in a single file. It's a valuable tool for development, testing, and deploying multi-container Docker applications.


Example:

Below is the example of the `docker-compose.yaml` file for a simple express MVC project.

```yaml
services:
  database:
    image: mongo
    ports:
      - 27017:27017

  express-server:
    build:
      context: ./
      dockerfile: Dockerfile
    ports:
      - 8000:8000
```