---
author: Tejas Nirala
---
# Docker Fundamentals

## Images vs Containers

### Images
A Docker "image" behaves like a template from which consistent containers can be created. If Docker was a traditional virtual machine, the image could be likened to the ISO used to install your VM. This isn't a robust comparison, as Docker differs from VMs in terms of both concept and implementation, but it's a useful starting point nonetheless.

### Containers
Images define the initial filesystem state of new containers. They bundle your application's source code and its dependencies into a self-contained package that's ready to use with a container runtime. Within the image, filesystem content is represented as multiple independent layers.


## Multistage Build

Multistage build is used to create images more efficiently by separating the build stage and runtime stage using multiple FROM instructions.

In the below mentioned Dockerfile example, there is build stage( base ) and two runtime stages( production and development ). The development stage is initiated by setting the --target development field in the docker run command. It generally uses the nodemon tool to start the server. This configuration is stored in package.json's script field with the key dev referring to development environment.

```dockerfile
# Build Stage
FROM node:alpine as base
WORKDIR /usr/src/app
COPY package.* .
RUN npm install

# Runtime Stage: Production
FROM base as production
COPY . .
EXPOSE 8000
CMD [ "node", "index.js" ]

# Runtime Stage: Development
FROM base as development
COPY . .
EXPOSE 8000
CMD [ "npm", "run", "dev" ]
```