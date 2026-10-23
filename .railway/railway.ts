import { defineRailway, github, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const repository = github("blessed-user/THE-DERELICT", {
    branch: "main",
    checkSuites: false,
  });

  const zebraVolume = volume("zebra-volume", {
    region: "iad",
    sizeMB: 500,
  });
  const funderVolume = volume("funder-volume", {
    region: "iad",
    sizeMB: 500,
  });
  const gameVolume = volume("game-volume", {
    region: "iad",
    sizeMB: 500,
  });

  const game = service("THE-DERELICT", {
    source: repository,
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "/Dockerfile",
    },
    deploy: {
      healthcheckPath: "/api/health",
    },
    replicas: { iad: 1 },
    volumeMounts: {
      "/data": gameVolume,
    },
    networking: {
      privateNetworkEndpoint: "the-derelict",
    },
  });
  const zebra = service("zebra", {
    source: repository,
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "/docker/railway/Zebra.Dockerfile",
    },
    replicas: { iad: 1 },
    volumeMounts: {
      "/var/cache/zebra": zebraVolume,
    },
  });
  const bootstrap = service("bootstrap", {
    source: repository,
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "/docker/railway/Bootstrap.Dockerfile",
    },
    replicas: { iad: 1 },
  });
  const funder = service("funder", {
    source: repository,
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "/docker/zecd/Dockerfile",
    },
    replicas: { iad: 1 },
    volumeMounts: {
      "/var/lib/zecd": funderVolume,
    },
  });

  return project("accomplished-learning", {
    variables: { managed: false },
    resources: [game, zebra, bootstrap, funder, zebraVolume, funderVolume, gameVolume],
  });
});
