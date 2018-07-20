'use strict'
var util = require("util");
var Promise = require("bluebird");
var fs = Promise.promisifyAll(require("fs"));
var request = require("requestretry");
var cheerio = require("cheerio");
var program = require('commander')
var flatten = require("array-flatten")
var toCSV = require("array-to-csv")

var headersIndex = ["Brand and Model"]

function increaseVerbosity(v, total) {
    return total + 1
}

function isRegExp(val) {
    let matches = val.match(/^\/(.+)\/(\w+)?$/)
    if (matches) {
        matches[2] = matches[2] || ""
        return matches.splice(1)
    }
    return null
}

function save(data) {
    if (program.verbose > 0)
        console.log("About to save the information to CSV file.")

    let flattened_data = flatten([].slice.call(arguments))

    let date = new Date().toISOString().slice(0, 19).replace(/:/g, "-").replace(/T/g, " ");
    let filename = "gsm " + date + ".csv"
    let content = toCSV([headersIndex], program.separator) + "\n" + flattened_data.join("\n")
    fs.writeFileAsync(filename, content).then(function() {
        console.log(util.format("%d records saved to %s!", flattened_data.length, filename))
    }).catch(errorHandler)
}


function parse(data) {
    let row = []
    let jq = cheerio.load(data)
    if (program.verbose > 0)
        console.log(util.format("Parsing %s...", jq("h1.specs-phone-name-title").text()))

    row[0] = jq("h1.specs-phone-name-title").text()
    jq("#specs-list table").each(function() {
        let header0 = ""
        jq("tr", this).each(function(i) {
            if (i == 0)
                header0 = jq("th", this).eq(0).text()
            let header1 = jq("td", this).eq(0).text()
            let value = jq("td", this).eq(1).text()
            let header = (header1.length) ? header0 + " - " + header1 : header0
            if (headersIndex.indexOf(header) == -1)
                headersIndex.push(header)
            row[headersIndex.indexOf(header)] = value;
        })
    })
    return toCSV([row], program.separator)
}

var getProducts = function(url, stopFindPages, data) {
    if (program.verbose > 0)
        console.log(util.format("Finding products from %s.", url))
    let deferreds = []
    let jq = cheerio.load(data)
    if (!stopFindPages)
        jq("div.nav-pages a").each(function() {
            let url = domain + this.attribs['href']
            if (program.verbose > 1)
                console.log(util.format("Additional product lists found at %s.", url))
            deferreds.push(
                baseRequest({
                    url: url
                }).then(getProducts.bind(null, url, true)).catch(errorHandler)
            )
        })

    jq("div.makers a").each(function() {
        let url = domain + this.attribs['href']
        if (program.verbose > 1)
            console.log(util.format("Products url %s found, pending to be downloaded.", url))
        let model = jq("span", this).text()

        if (!program.model || (program.model && (typeof program.model == "object" && program.model.test(model) || model.toLowerCase().indexOf(program.model.toLowerCase()) != -1)))
            deferreds.push(baseRequest({
                url: url
            }).then(parse).catch(errorHandler))
    })
    return Promise.all(deferreds);
}

headersIndex = ["Brand and Model"]
var domain = "http://www.gsmarena.com/"

function main(min, max) {
    let deferreds = []
    baseRequest({
        url: "http://www.gsmarena.com/makers.php3"
    }).then(function(res) {
        let $ = cheerio.load(res)
        let $a = $("div.st-text td > a")
        let totalPhones = $a.map(function() {
            return $("span", this).text().split(" ")[0]
        }).get().reduce((a, b) => parseInt(a) + parseInt(b), 0)
        console.log(util.format("%d makers and %d phones found before filter.", $a.length, totalPhones))
        totalPhones = 0
        $a.each(function(i) {
            min = (typeof min != "undefined") ? min : 0
            max = (typeof max != "undefined") ? max : 99999
            if (i >= min && i <= max) {
                let url = domain + this.attribs.href

                let brand = this.children[0].data
                if (program.verbose > 1)
                    console.log(util.format("Found makers url: %s", url))

                if (!program.brand || (program.brand && (typeof program.brand == "object" && program.brand.test(brand) || brand.toLowerCase().indexOf(program.brand.toLowerCase()) != -1))) {
                    deferreds.push(
                        baseRequest({
                            url: url
                        }).then(getProducts.bind(null, url, false)).catch(errorHandler)
                    )
                    totalPhones += parseInt($("span", this).text().split(" ")[0])
                }
            }
        })
        if (program.brand)
            console.log(util.format("%d makers and %d phones left after filter!", deferreds.length, totalPhones))
        console.log("Begins to parse and download product lists and information, it can take very long time, be patient.")
        return Promise.all(deferreds).then(save, save)
    }).catch(errorHandler)
}

function errorHandler(e) {
    console.error(e);
    if (program.exit)
        process.exit(1)
}

function banner() {
    console.log("gsmarena.com phone info dumping tool");
}

program
    .version('1.0.2')
    .option('-b, --brand <keywords or regular expression>', 'Download only phone info with brands matching <keywords> or <regular expression>', "")
    .option('-d, --model <keywords or regular expression>', 'Download only phone info with models matching <keywords> or <regular expression>', "")
    .option('-s, --separator <separator>', 'separator of saved file [default: <TAB>]', "\t")
    .option('-m, --max-connection <max connection>', 'Maximum simultaneous HTTP connections, default is 2', parseInt, 2)
    .option('-t, --timeout <time in ms>', 'Timeout for each HTTP request, default is 60000ms', parseInt, 60000)
    .option('-r, --retry <count>', 'Retry if HTTP connections failed, default is 10', parseInt, 10)
    .option('-R, --retry-delay <time in ms>', 'Retry dealy if HTTP connections failed, default is 60000ms', parseInt, 60000)
    .option('-a, --user-agent <user agent>', 'User agent in HTTP request header, default is "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:15.0) Gecko/20100101 Firefox/15.0.1"', 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:15.0) Gecko/20100101 Firefox/15.0.1')
    .option('-e, --exit', 'Exit on error, don\'t continue')
    .option('-v, --verbose', 'Be more verbose (max -vvv)', increaseVerbosity, 0)
    .parse(process.argv)

let re = isRegExp(program.brand)
if (re)
    program.brand = new RegExp(re[0], re[1])

re = isRegExp(program.model)
if (re)
    program.model = new RegExp(re[0], re[1])

var baseRequest = request.defaults({
    maxAttempts: program.retry,
    retryDelay: program.retryDelay,
    pool: {
        maxSockets: program.maxConnection
    },
    timeout: program.timeout,
    headers: {
        'User-Agent': program.userAgent
    },
    fullResponse: false
})

banner();
main();
