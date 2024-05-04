//javascri[t of responsive navigation menu
const menubtn = document.querySelector(".menu-btn");
const navigation = document.querySelector(".navigation");

menubtn.addEventListener('click', () => {
    menubtn.classList.toggle("active");
    navigation.classList.toggle("active");
});

//javascript for video slider navigation
const btns = document.querySelectorAll(".nav-btn");
const slides = document.querySelectorAll(".video-slide");
const contents = document.querySelectorAll(".content");

var sliderNav = function (manual) {
    btns.forEach((btn) => {
        btn.classList.remove("active");
    });

    slides.forEach((slide) => {
        slide.classList.remove("active");
    });

    contents.forEach((content) => {
        content.classList.remove("active");
    });

    btns[manual].classList.add("active");
    slides[manual].classList.add("active");
    contents[manual].classList.add("active");
    
}

btns.forEach((btn, i) => {
    btn.addEventListener("click", () => {
        sliderNav(i);
    });
});

//all videos auto play 
document.addEventListener("DOMContentLoaded", function() {
    var videos = document.getElementsByClassName('video');

    Array.from(videos).forEach(function(video) {
        // Detectar si el dispositivo es móvil
        var isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        if (isMobile) {
            video.setAttribute('autoplay', '');
            video.setAttribute('muted', '');
            video.setAttribute('playsinline', '');
        }

        video.addEventListener("loadedmetadata", function() {
            // Establecer el tiempo de inicio en el segundo 15 después de que se carguen los metadatos
            video.currentTime = 15;
        });
    });
});


///////////////////////////////////////////////////////////////////////////////////////////
// NOSOTROS//
//animacion de scroll
const images = document.querySelectorAll('.content-scroll');

function trigggerAnimation(entries){
    entries.forEach(entry => {
        const image = entry.target.querySelector('img');

        image.classList.toggle('unset',entry.isIntersecting)

    });

}

const options = {
    root: null,
    rootMargin: '0px',
    threshold: 0.9
}

const observer = new IntersectionObserver(trigggerAnimation, options);

images.forEach(image => {
    observer.observe(image);
});

///////////////////////////////////////////////////////////////////////////////////////////
// SERVICIOS//
var bannerElements = document.querySelectorAll('.banner-element');

bannerElements.forEach(function(element) {
    element.addEventListener('click', function() {
        window.location.href = 'contacto.html';
    });
});


///////////////////////////////////////////////////////////////////////////////////////////
//loader
var preloader = document.getElementById('preloader');

window.addEventListener("load", function(){
    preloader.style.display = 'none';
});
