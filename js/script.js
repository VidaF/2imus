/* global THREE */
/* global TransformStream */
/* global TextEncoderStream */
/* global TextDecoderStream */
'use strict';

import * as THREE from 'three';
import { OBJLoader } from 'objloader';

let port1, port2;
let reader1, reader2;
let inputDone1, inputDone2;
let outputDone1, outputDone2;
let inputStream1, inputStream2;
let outputStream1, outputStream2;
let showCalibration = false;

let orientation1 = [0, 0, 0];
let quaternion1 = [1, 0, 0, 0];
let calibration1 = [0, 0, 0, 0];

let orientation2 = [0, 0, 0];
let quaternion2 = [1, 0, 0, 0];
let calibration2 = [0, 0, 0, 0];

const maxLogLength = 100;
const log = document.getElementById('log');
const butConnect = document.getElementById('butConnect');
const butClear = document.getElementById('butClear');
const baudRate = document.getElementById('baudRate');
const autoscroll = document.getElementById('autoscroll');
const showTimestamp = document.getElementById('showTimestamp');
const angleType = document.getElementById('angle_type');
const lightSS = document.getElementById('light');
const darkSS = document.getElementById('dark');
const darkMode = document.getElementById('darkmode');
const canvas = document.querySelector('#canvas');
const calContainer = document.getElementById('calibration');
const logContainer = document.getElementById("log-container");

fitToContainer(canvas);

function fitToContainer(canvas) {
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
}

document.addEventListener('DOMContentLoaded', async () => {
  butConnect.addEventListener('click', clickConnect);
  butClear.addEventListener('click', clickClear);
  autoscroll.addEventListener('click', clickAutoscroll);
  showTimestamp.addEventListener('click', clickTimestamp);
  baudRate.addEventListener('change', changeBaudRate);
  angleType.addEventListener('change', changeAngleType);
  darkMode.addEventListener('click', clickDarkMode);

  if ('serial' in navigator) {
    const notSupported = document.getElementById('notSupported');
    notSupported.classList.add('hidden');
  } else {
    alert('Web Serial API is not supported in this browser.');
  }

  if (isWebGLAvailable()) {
    const webGLnotSupported = document.getElementById('webGLnotSupported');
    webGLnotSupported.classList.add('hidden');
  }

  initBaudRate();
  loadAllSettings();
  updateTheme();
  await finishDrawing();
  await render();
});

async function connect() {
  if (!('serial' in navigator)) {
    alert('Web Serial API is not supported in this browser.');
    return;
  }
  [port1, port2] = await Promise.all([navigator.serial.requestPort(), navigator.serial.requestPort()]);
  await Promise.all([port1.open({ baudRate: baudRate.value }), port2.open({ baudRate: baudRate.value })]);

  let decoder1 = new TextDecoderStream();
  let decoder2 = new TextDecoderStream();

  inputDone1 = port1.readable.pipeTo(decoder1.writable);
  inputDone2 = port2.readable.pipeTo(decoder2.writable);

  inputStream1 = decoder1.readable.pipeThrough(new TransformStream(new LineBreakTransformer()));
  inputStream2 = decoder2.readable.pipeThrough(new TransformStream(new LineBreakTransformer()));

  reader1 = inputStream1.getReader();
  reader2 = inputStream2.getReader();

  readLoop(reader1, 1);
  readLoop(reader2, 2);
}

async function disconnect() {
  if (reader1) {
    await reader1.cancel();
    await inputDone1.catch(() => {});
    reader1 = null;
    inputDone1 = null;
  }

  if (reader2) {
    await reader2.cancel();
    await inputDone2.catch(() => {});
    reader2 = null;
    inputDone2 = null;
  }

  if (outputStream1) {
    await outputStream1.getWriter().close();
    await outputDone1;
    outputStream1 = null;
    outputDone1 = null;
  }

  if (outputStream2) {
    await outputStream2.getWriter().close();
    await outputDone2;
    outputStream2 = null;
    outputDone2 = null;
  }

  await Promise.all([port1.close(), port2.close()]);
  port1 = null;
  port2 = null;
  showCalibration = false;
}

async function readLoop(reader, imuNumber) {
  while (true) {
    const { value, done } = await reader.read();
    if (value) {
      if (value.startsWith("Orientation:")) {
        if (imuNumber === 1) {
          orientation1 = value.substr(12).trim().split(",").map(x => +x);
        } else {
          orientation2 = value.substr(12).trim().split(",").map(x => +x);
        }
      }
      if (value.startsWith("Quaternion:")) {
        if (imuNumber === 1) {
          quaternion1 = value.substr(11).trim().split(",").map(x => +x);
        } else {
          quaternion2 = value.substr(11).trim().split(",").map(x => +x);
        }
      }
      if (value.startsWith("Calibration:")) {
        if (imuNumber === 1) {
          calibration1 = value.substr(12).trim().split(",").map(x => +x);
        } else {
          calibration2 = value.substr(12).trim().split(",").map(x => +x);
        }
        if (!showCalibration) {
          showCalibration = true;
          updateTheme();
        }
      }
    }
    if (done) {
      reader.releaseLock();
      break;
    }
  }
}

const renderer = new THREE.WebGLRenderer({ canvas });
const camera = new THREE.PerspectiveCamera(45, canvas.width / canvas.height, 0.1, 100);
camera.position.set(0, 0, 30);

const scene = new THREE.Scene();
scene.background = new THREE.Color('black');
{
  const skyColor = 0xB1E1FF;
  const groundColor = 0x666666;
  const intensity = 0.5;
  const light = new THREE.HemisphereLight(skyColor, groundColor, intensity);
  scene.add(light);
}

{
  const color = 0xFFFFFF;
  const intensity = 1;
  const light = new THREE.DirectionalLight(color, intensity);
  light.position.set(0, 10, 0);
  light.target.position.set(-5, 0, 0);
  scene.add(light);
  scene.add(light.target);
}

let bunny1, bunny2;
{
const objLoader = new OBJLoader();
objLoader.load('assets/bunny.obj', (root) => {
  bunny1 = root.clone();
  scene.add(bunny1);
  bunny2 = root.clone();
  scene.add(bunny2);
});
}
function resizeRendererToDisplaySize(renderer) {
  const canvas = renderer.domElement;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const needResize = canvas.width !== width || canvas.height !== height;
  if (needResize) {
    renderer.setSize(width, height, false);
  }
  return needResize;
}

async function render() {
  if (resizeRendererToDisplaySize(renderer)) {
    const canvas = renderer.domElement;
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
  }

  if (bunny1 && bunny2) {
    if (angleType.value == "euler") {
      let rotationEuler1 = new THREE.Euler(
        THREE.MathUtils.degToRad(360 - orientation1[2]),
        THREE.MathUtils.degToRad(orientation1[0]),
        THREE.MathUtils.degToRad(orientation1[1]),
        'YZX'
      );
      bunny1.setRotationFromEuler(rotationEuler1);

      let rotationEuler2 = new THREE.Euler(
        THREE.MathUtils.degToRad(360 - orientation2[2]),
        THREE.MathUtils.degToRad(orientation2[0]),
        THREE.MathUtils.degToRad(orientation2[1]),
        'YZX'
      );
      bunny2.setRotationFromEuler(rotationEuler2);
    } else {
      let rotationQuaternion1 = new THREE.Quaternion(quaternion1[1], quaternion1[3], -quaternion1[2], quaternion1[0]);
      bunny1.setRotationFromQuaternion(rotationQuaternion1);

      let rotationQuaternion2 = new THREE.Quaternion(quaternion2[1], quaternion2[3], -quaternion2[2], quaternion2[0]);
      bunny2.setRotationFromQuaternion(rotationQuaternion2);
    }
  }

  renderer.render(scene, camera);
  updateCalibration();
  await sleep(10);
  await finishDrawing();
  await render();
}

